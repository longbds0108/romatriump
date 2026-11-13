// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Triumph} from "../src/Triumph.sol";
import {IERC20SPLFactory, ICpi} from "../src/IRome.sol";
import {
    Ledger,
    MockHelper,
    MockCpi,
    MockSplCached,
    MockAssociatedSplCached,
    MockFactory
} from "./mocks/RomeMocks.sol";

contract TriumphTest is Test {
    address constant HELPER = 0xff00000000000000000000000000000000000009;
    address constant CPI = 0xFF00000000000000000000000000000000000008;
    address constant SPL = 0xff00000000000000000000000000000000000005;
    address constant ASPL = 0xFF00000000000000000000000000000000000006;

    bytes32 constant USDC = keccak256("usdc-mint");
    bytes32 constant DAMM = keccak256("meteora-damm");
    bytes32 constant VAULT = keccak256("meteora-vault");
    bytes32 constant MPL = keccak256("metaplex");
    bytes32 constant TOKEN_PROG = keccak256("spl-token");
    bytes32 constant ATA_PROG = keccak256("ata");
    bytes32 constant SYS = bytes32(0);
    bytes32 constant RENT = keccak256("rent");

    uint64 constant V = 2_000_000; // 2 USDC virtual
    uint64 constant R = 4_000_000; // graduate at 4 USDC raised

    Ledger L;
    MockFactory factory;
    Triumph t;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        L = new Ledger();
        L.setPrograms(DAMM, VAULT);
        vm.etch(HELPER, address(new MockHelper(L)).code);
        vm.etch(CPI, address(new MockCpi(L)).code);
        vm.etch(SPL, address(new MockSplCached(L)).code);
        vm.etch(ASPL, address(new MockAssociatedSplCached(L)).code);
        factory = new MockFactory();
        L.seedMint(USDC);

        t = new Triumph(
            Triumph.Config({
                factory: IERC20SPLFactory(address(factory)),
                usdcMint: USDC,
                meteoraDamm: DAMM,
                meteoraVault: VAULT,
                metadataProgram: MPL,
                tokenProgram: TOKEN_PROG,
                ataProgram: ATA_PROG,
                systemProgram: SYS,
                rentSysvar: RENT,
                virtualUsdc: V,
                graduationUsdc: R,
                poolFeeBps: 25
            })
        );

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            L.seed(L.pda(users[i]), USDC, 100_000_000); // 100 USDC each
            _grant(users[i], USDC);
        }
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    function _grant(address user, bytes32 mint) internal {
        L.newTx();
        vm.prank(user);
        MockHelper(HELPER).approve_spl(address(t), type(uint64).max, mint);
    }

    function _launch(address who, string memory sym) internal returns (uint256 id, bytes32 mint) {
        L.newTx();
        vm.prank(who);
        (id, mint) = t.launch("Triumph Token", sym);
    }

    function _buy(address who, uint256 id, uint256 usdc) internal returns (uint256 out) {
        L.newTx();
        vm.prank(who);
        out = t.buy(id, usdc, 0);
    }

    function _sell(address who, uint256 id, uint256 tokens) internal returns (uint256 out) {
        L.newTx();
        vm.prank(who);
        out = t.sell(id, tokens, 0);
    }

    function _usdc(address who) internal view returns (uint64) {
        return L.balance(USDC, L.pda(who));
    }

    function _tok(bytes32 mint, address who) internal view returns (uint64) {
        return L.balance(mint, L.pda(who));
    }

    function _vaultAccts(bytes32 mint) internal view returns (bytes32[] memory a) {
        a = new bytes32[](8);
        a[0] = keccak256(abi.encodePacked("vault", mint));
        a[1] = L.pda(address(t));
        a[2] = keccak256(abi.encodePacked("token_vault", mint));
        a[3] = mint;
        a[4] = keccak256(abi.encodePacked("vault_lp_mint", mint));
        a[5] = RENT;
        a[6] = TOKEN_PROG;
        a[7] = SYS;
    }

    function _poolAccts(bytes32 mint) internal view returns (bytes32[] memory a) {
        a = new bytes32[](26);
        bytes32 me = L.pda(address(t));
        for (uint256 i; i < 26; ++i) a[i] = keccak256(abi.encodePacked("acct", mint, i));
        a[2] = mint;
        a[3] = USDC;
        a[4] = keccak256(abi.encodePacked("vault", mint)); // a_vault
        a[12] = L.ata(me, mint);
        a[13] = L.ata(me, USDC);
        a[17] = me;
        a[19] = RENT;
        a[21] = MPL;
        a[22] = VAULT;
        a[23] = TOKEN_PROG;
        a[24] = ATA_PROG;
        a[25] = SYS;
    }

    function _complete(uint256 id) internal {
        _buy(alice, id, 50_000_000);
        assertEq(uint8(t.getLaunch(id).status), uint8(Triumph.Status.Completed));
    }

    // ─── curve parameters ─────────────────────────────────────────────────────

    function test_supplySplitAddsUp() public view {
        assertEq(uint256(t.curveSupply()) + t.lpSupply(), t.TOTAL_SUPPLY());
        assertEq(t.k(), uint256(V) * t.virtualTokens0());
    }

    /// The pool must open at the curve's final price: (V+R)/(Y0-C) == R/L.
    function test_poolOpensAtCurveEndPrice() public view {
        uint256 endX = uint256(V) + R;
        uint256 endY = t.virtualTokens0() - t.curveSupply();
        uint256 L_ = t.lpSupply();
        // endX/endY vs R/L_  →  endX*L_ vs R*endY, equal within rounding (1e-9 relative)
        uint256 a = endX * L_;
        uint256 b = uint256(R) * endY;
        uint256 diff = a > b ? a - b : b - a;
        assertLe(diff * 1e9, a);
    }

    // ─── launch ───────────────────────────────────────────────────────────────

    function test_launchMintsFixedSupplyToPda() public {
        bytes32 predicted = t.nextMint();
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        assertEq(id, 0);
        assertEq(mint, predicted);
        assertEq(L.mintAuthority(mint), L.pda(address(t)));
        assertEq(L.supply(mint), t.TOTAL_SUPPLY());
        assertEq(_tok(mint, address(t)), t.TOTAL_SUPPLY());
        Triumph.Launch memory l = t.getLaunch(0);
        assertEq(l.creator, carol);
        assertEq(uint8(l.status), uint8(Triumph.Status.Trading));
        assertEq(t.launchIdByMint(mint), 1);
        // the PDA keeps its rent floor after paying for mint + ATA
        assertGe(L.lamports(L.pda(address(t))), 890_880);
    }

    function test_launchRejectsDuplicateSymbolAndBadNames() public {
        _launch(carol, "TRI");
        L.newTx();
        vm.expectRevert(Triumph.SymbolTaken.selector);
        t.launch("Other", "TRI");
        vm.expectRevert(Triumph.BadName.selector);
        t.launch("", "X");
        vm.expectRevert(Triumph.BadName.selector);
        t.launch("Name", "TOOLONGSYMBOL");
        vm.expectRevert(Triumph.BadName.selector);
        t.launch("A name that is longer than thirty-two bytes", "OK");
    }

    function test_launchesGetDistinctMints() public {
        (, bytes32 m0) = _launch(carol, "A");
        (, bytes32 m1) = _launch(carol, "B");
        assertTrue(m0 != m1);
        assertEq(t.launchCount(), 2);
    }

    function test_registerWrapperIsIdempotent() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        L.newTx();
        address w = t.registerWrapper(id);
        assertEq(factory.token_by_mint(mint), w);
        assertEq(t.registerWrapper(id), w);
        assertEq(t.getLaunch(id).wrapper, w);
    }

    // ─── trading ──────────────────────────────────────────────────────────────

    function test_buyMovesUsdcInAndTokensOut() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        (uint256 quoted, uint256 charged, uint256 fee) = t.quoteBuy(id, 1_000_000);
        uint256 out = _buy(alice, id, 1_000_000);
        assertEq(out, quoted);
        assertEq(charged, 1_000_000);
        assertEq(fee, 10_000);
        assertEq(_usdc(alice), 99_000_000);
        assertEq(_tok(mint, alice), out);
        assertEq(_usdc(address(t)), 1_000_000);
        assertEq(t.protocolFees(), 10_000);
        assertEq(t.getLaunch(id).raised, 990_000);
        assertEq(t.getLaunch(id).sold, out);
    }

    function test_firstBuyMatchesClosedForm() public {
        (uint256 id,) = _launch(carol, "TRI");
        uint256 out = _buy(alice, id, 1_000_000);
        // y - k/(x+net), net = 0.99 USDC
        uint256 expected = t.virtualTokens0() - (t.k() + (V + 990_000) - 1) / (V + 990_000);
        assertEq(out, expected);
    }

    function test_priceRisesWithBuys() public {
        (uint256 id,) = _launch(carol, "TRI");
        uint256 a = _buy(alice, id, 500_000);
        uint256 b = _buy(bob, id, 500_000);
        assertLt(b, a);
    }

    function test_buyWithoutGrantReverts() public {
        (uint256 id,) = _launch(carol, "TRI");
        address eve = makeAddr("eve");
        L.seed(L.pda(eve), USDC, 5_000_000);
        L.newTx();
        vm.prank(eve);
        vm.expectRevert(); // SPL 0x4: Triumph is not eve's delegate
        t.buy(id, 1_000_000, 0);
    }

    function test_buySlippage() public {
        (uint256 id,) = _launch(carol, "TRI");
        (uint256 quoted,,) = t.quoteBuy(id, 1_000_000);
        L.newTx();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Triumph.Slippage.selector, quoted, quoted + 1));
        t.buy(id, 1_000_000, quoted + 1);
    }

    function test_sellRoundTripLosesOnlyFees() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        uint256 out = _buy(alice, id, 1_000_000);
        _grant(alice, mint);
        uint256 back = _sell(alice, id, out);
        // ≈ 2% fees + rounding dust
        assertApproxEqAbs(back, 980_100, 2);
        assertEq(_tok(mint, alice), 0);
        assertEq(t.getLaunch(id).sold, 0);
        assertLe(t.getLaunch(id).raised, 2); // only rounding dust stays with the curve
    }

    function test_sellMoreThanSoldReverts() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        uint256 out = _buy(alice, id, 1_000_000);
        _grant(alice, mint);
        L.newTx();
        vm.prank(alice);
        vm.expectRevert(Triumph.ExceedsReserve.selector);
        t.sell(id, out + 1, 0);
    }

    function test_cannotSellSomeoneElsesTokens() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        uint256 out = _buy(alice, id, 1_000_000);
        _grant(alice, mint);
        // bob holds nothing; sell pulls from msg.sender only
        L.newTx();
        vm.prank(bob);
        vm.expectRevert();
        t.sell(id, out, 0);
        assertEq(_tok(mint, alice), out);
    }

    function test_finalBuyIsCappedAndCompletesCurve() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        _buy(bob, id, 1_000_000);
        uint256 before = _usdc(alice);
        _buy(alice, id, 50_000_000);
        Triumph.Launch memory l = t.getLaunch(id);
        assertEq(uint8(l.status), uint8(Triumph.Status.Completed));
        assertEq(l.raised, R);
        assertEq(l.sold, t.curveSupply());
        // alice paid only what completed the curve, not 50 USDC
        assertLt(before - _usdc(alice), 3_100_000);
        // the contract still holds exactly the reserve
        assertEq(_tok(mint, address(t)), t.lpSupply());
    }

    function test_tradingHaltsAfterCompletion() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        _complete(id);
        L.newTx();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Triumph.WrongStatus.selector, Triumph.Status.Completed));
        t.buy(id, 1_000_000, 0);
        _grant(alice, mint);
        L.newTx();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Triumph.WrongStatus.selector, Triumph.Status.Completed));
        t.sell(id, 1, 0);
    }

    /// Solvency across two launches with random flow: the PDA's USDC equals every open
    /// curve's raise plus fees, and its token balance equals the unsold supply.
    function testFuzz_solvency(uint256 seed) public {
        (uint256 id0, bytes32 m0) = _launch(carol, "AAA");
        (uint256 id1, bytes32 m1) = _launch(carol, "BBB");
        for (uint256 i; i < 24; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 id = seed & 1 == 0 ? id0 : id1;
            bytes32 m = id == id0 ? m0 : m1;
            address who = (seed >> 1) & 1 == 0 ? alice : bob;
            if (t.getLaunch(id).status != Triumph.Status.Trading) continue;
            if ((seed >> 2) % 3 != 0) {
                uint256 amt = 1_000 + ((seed >> 8) % 1_500_000);
                if (_usdc(who) < amt) continue;
                _buy(who, id, amt);
            } else {
                uint256 bal = _tok(m, who);
                if (bal == 0) continue;
                _grant(who, m);
                uint256 amt = 1 + ((seed >> 8) % bal);
                (uint256 q,) = t.quoteSell(id, amt);
                if (q == 0) continue;
                _sell(who, id, amt);
            }
        }
        Triumph.Launch memory l0 = t.getLaunch(id0);
        Triumph.Launch memory l1 = t.getLaunch(id1);
        assertEq(_usdc(address(t)), uint256(l0.raised) + l1.raised + t.protocolFees());
        assertEq(_tok(m0, address(t)), t.TOTAL_SUPPLY() - l0.sold);
        assertEq(_tok(m1, address(t)), t.TOTAL_SUPPLY() - l1.sold);
        assertLe(l0.raised, R);
        assertLe(l0.sold, t.curveSupply());
        // users' USDC + contract USDC is conserved
        assertEq(uint256(_usdc(alice)) + _usdc(bob) + _usdc(address(t)), 200_000_000);
    }

    // ─── graduation ───────────────────────────────────────────────────────────

    function test_graduateRequiresCompletionAndVault() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        bytes32[] memory p = _poolAccts(mint);
        L.newTx();
        vm.expectRevert(abi.encodeWithSelector(Triumph.WrongStatus.selector, Triumph.Status.Trading));
        t.graduate(id, p);
        _complete(id);
        L.newTx();
        vm.expectRevert(Triumph.VaultMissing.selector);
        t.graduate(id, p);
    }

    function test_initTokenVaultPinsAccountsAndIsIdempotent() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        bytes32[] memory a = _vaultAccts(mint);
        uint8[5] memory pinned = [1, 3, 5, 6, 7];
        for (uint256 i; i < pinned.length; ++i) {
            bytes32[] memory bad = _vaultAccts(mint);
            bad[pinned[i]] = keccak256("evil");
            L.newTx();
            vm.expectRevert(abi.encodeWithSelector(Triumph.BadAccounts.selector, uint256(pinned[i])));
            t.initTokenVault(id, bad);
        }
        L.newTx();
        t.initTokenVault(id, a);
        assertTrue(t.getLaunch(id).vaultReady);
        assertEq(L.lastProgram(), VAULT);
        assertTrue(L.lastMeta(1).is_signer);
        assertEq(L.lastData(), hex"afaf6d1f0d989bed");
        uint256 n = L.invokeCount();
        L.newTx();
        t.initTokenVault(id, a);
        assertEq(L.invokeCount(), n);
    }

    function test_initTokenVaultAdoptsExistingVault() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        bytes32[] memory a = _vaultAccts(mint);
        L.addLamports(a[0], 1); // someone already created it
        L.newTx();
        t.initTokenVault(id, a);
        assertTrue(t.getLaunch(id).vaultReady);
        assertEq(L.invokeCount(), 0);
    }

    function test_graduateRejectsEveryTamperedPinnedAccount() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        (, bytes32 other) = _launch(carol, "OTH");
        _complete(id);
        L.newTx();
        t.initTokenVault(id, _vaultAccts(mint));
        uint8[11] memory pinned = [2, 3, 12, 13, 17, 19, 21, 22, 23, 24, 25];
        for (uint256 i; i < pinned.length; ++i) {
            bytes32[] memory bad = _poolAccts(mint);
            bad[pinned[i]] = pinned[i] == 2 ? other : keccak256("evil");
            L.newTx();
            vm.expectRevert(abi.encodeWithSelector(Triumph.BadAccounts.selector, uint256(pinned[i])));
            t.graduate(id, bad);
        }
        bytes32[] memory short_ = new bytes32[](25);
        L.newTx();
        vm.expectRevert(abi.encodeWithSelector(Triumph.BadAccounts.selector, uint256(25)));
        t.graduate(id, short_);
    }

    function test_graduateSeedsPoolAndLocksLp() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI");
        _buy(bob, id, 2_000_000);
        _complete(id);
        L.newTx();
        t.initTokenVault(id, _vaultAccts(mint));
        bytes32[] memory p = _poolAccts(mint);
        uint256 feesBefore = t.protocolFees();

        L.newTx();
        vm.prank(carol);
        t.graduate(id, p);

        Triumph.Launch memory l = t.getLaunch(id);
        assertEq(uint8(l.status), uint8(Triumph.Status.Graduated));
        assertEq(l.pool, p[0]);
        assertEq(l.lpMint, p[1]);
        assertEq(l.raised, 0);
        // pool holds the full raise and the reserve
        assertEq(L.balance(USDC, p[0]), R);
        assertEq(L.balance(mint, p[0]), t.lpSupply());
        // contract keeps only protocol fees in USDC and nothing of the token
        assertEq(_usdc(address(t)), feesBefore);
        assertEq(_tok(mint, address(t)), 0);
        // LP sits with the contract PDA, and no function can move it
        assertGt(L.balance(p[1], L.pda(address(t))), 0);

        // instruction data: disc | curve 0 | fee 25 | tokenA | tokenB, all u64 LE
        bytes memory d = L.lastData();
        assertEq(d.length, 33);
        assertEq(bytes8(_slice8(d, 0)), bytes8(0x06874493e552a971));
        assertEq(uint8(d[8]), 0);
        assertEq(_le(d, 9), 25);
        assertEq(_le(d, 17), t.lpSupply());
        assertEq(_le(d, 25), R);
        // signer + writability flags
        assertEq(L.lastMetaCount(), 26);
        for (uint256 i; i < 26; ++i) {
            ICpi.AccountMeta memory m = L.lastMeta(i);
            assertEq(m.is_signer, i == 17);
            bool ro = i == 2 || i == 3 || i == 18 || i == 19 || i >= 21;
            assertEq(m.is_writable, !ro);
        }

        L.newTx();
        vm.expectRevert(abi.encodeWithSelector(Triumph.WrongStatus.selector, Triumph.Status.Graduated));
        t.graduate(id, p);
    }

    function test_graduationDoesNotTouchOtherLaunches() public {
        (uint256 id0, bytes32 m0) = _launch(carol, "AAA");
        (uint256 id1, bytes32 m1) = _launch(carol, "BBB");
        _buy(bob, id1, 1_500_000);
        _complete(id0);
        L.newTx();
        t.initTokenVault(id0, _vaultAccts(m0));
        L.newTx();
        t.graduate(id0, _poolAccts(m0));
        Triumph.Launch memory l1 = t.getLaunch(id1);
        assertEq(_usdc(address(t)), uint256(l1.raised) + t.protocolFees());
        assertEq(_tok(m1, address(t)), t.TOTAL_SUPPLY() - l1.sold);
    }

    // ─── rent + fees + admin ──────────────────────────────────────────────────

    function test_rentIsToppedUpOnlyByShortfall() public {
        _launch(carol, "A");
        uint256 billed = L.gasLamportsBilled();
        // second launch: PDA already holds leftover lamports, only the gap is billed
        _launch(carol, "B");
        uint256 second = L.gasLamportsBilled() - billed;
        assertLt(second, billed);
    }

    function test_withdrawFeesOnlyOwnerOnlyFees() public {
        (uint256 id,) = _launch(carol, "TRI");
        _buy(alice, id, 1_000_000);
        L.newTx();
        vm.prank(alice);
        vm.expectRevert(Triumph.NotOwner.selector);
        t.withdrawFees(alice);
        address treasury = makeAddr("treasury");
        L.newTx();
        t.withdrawFees(treasury);
        assertEq(_usdc(treasury), 10_000);
        assertEq(t.protocolFees(), 0);
        assertEq(_usdc(address(t)), t.getLaunch(id).raised);
    }

    function test_adminSetters() public {
        vm.prank(alice);
        vm.expectRevert(Triumph.NotOwner.selector);
        t.setRentBudgets(1, 2, 3);
        t.setRentBudgets(1, 2, 3);
        assertEq(t.poolRent(), 3);
        t.setOwner(alice);
        assertEq(t.owner(), alice);
    }

    /// Every entry point stays on one precompile track (the mock reverts on mixing).
    function test_entryPointsAreSingleTrack() public {
        (uint256 id, bytes32 mint) = _launch(carol, "TRI"); // legacy
        L.newTx();
        t.registerWrapper(id);
        uint256 got = _buy(alice, id, 1_000_000); // cached
        _grant(alice, mint);
        _sell(alice, id, got / 10); // cached
        _complete(id);
        L.newTx();
        t.initTokenVault(id, _vaultAccts(mint)); // legacy
        L.newTx();
        t.graduate(id, _poolAccts(mint)); // legacy
        L.newTx();
        t.withdrawFees(carol); // cached
    }

    function _slice8(bytes memory d, uint256 off) internal pure returns (bytes8 r) {
        assembly {
            r := mload(add(add(d, 32), off))
        }
    }

    function _le(bytes memory d, uint256 off) internal pure returns (uint64 v) {
        for (uint256 i; i < 8; ++i) v |= uint64(uint8(d[off + i])) << uint64(8 * i);
    }
}
