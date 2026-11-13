// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// LOCAL UI CHECK ONLY (anvil): drives real transactions through Triumph on the mocked local chain.
import {Script} from "forge-std/Script.sol";
import {Triumph} from "../src/Triumph.sol";
import {Ledger, MockHelper} from "../test/mocks/RomeMocks.sol";

contract LocalActivity is Script {
    MockHelper constant H = MockHelper(0xff00000000000000000000000000000000000009);
    bytes32 constant USDC = keccak256("usdc-mint");

    function run(address triumph, address ledger) external {
        Triumph t = Triumph(triumph);
        Ledger L = Ledger(ledger);
        // anvil's public default dev mnemonic (accounts 0-3), local chain only
        string memory mnemonic = "test test test test test test test test test test test junk";
        uint256[4] memory pk;
        for (uint256 i; i < 4; ++i) pk[i] = vm.deriveKey(mnemonic, uint32(i));
        address[4] memory who;
        for (uint256 i; i < 4; ++i) who[i] = vm.addr(pk[i]);

        vm.startBroadcast(pk[0]);
        for (uint256 i; i < 4; ++i) L.seed(L.pda(who[i]), USDC, 50_000_000);
        vm.stopBroadcast();
        for (uint256 i; i < 4; ++i) {
            vm.startBroadcast(pk[i]);
            H.approve_spl(triumph, type(uint64).max, USDC);
            vm.stopBroadcast();
        }

        string[3] memory names = ["Aurora Crown", "Laurel", "Forum Coin"];
        string[3] memory syms = ["AUR", "LAUR", "FORUM"];
        for (uint256 i; i < 3; ++i) {
            vm.startBroadcast(pk[i]);
            (uint256 id,) = t.launch(names[i], syms[i]);
            t.registerWrapper(id);
            vm.stopBroadcast();
        }

        // launch 0: busy curve, then completes and graduates
        _buy(t, pk[1], 0, 600_000);
        _buy(t, pk[2], 0, 450_000);
        _buy(t, pk[3], 0, 800_000);
        _sell(t, L, pk[2], who[2], 0);
        _buy(t, pk[0], 0, 5_000_000); // completes
        vm.startBroadcast(pk[3]);
        bytes32 mint = t.getLaunch(0).mint;
        t.initTokenVault(0, _vault(L, triumph, mint));
        t.graduate(0, _pool(L, triumph, mint));
        vm.stopBroadcast();

        // launch 1: half way
        _buy(t, pk[0], 1, 700_000);
        _buy(t, pk[3], 1, 500_000);
        _sell(t, L, pk[3], who[3], 1);
        _buy(t, pk[1], 1, 300_000);

        // launch 2: completed, waiting for graduation
        _buy(t, pk[2], 2, 1_000_000);
        _buy(t, pk[1], 2, 5_000_000);
    }

    function _buy(Triumph t, uint256 pk, uint256 id, uint256 amt) internal {
        vm.startBroadcast(pk);
        t.buy(id, amt, 0);
        vm.stopBroadcast();
    }

    function _sell(Triumph t, Ledger L, uint256 pk, address w, uint256 id) internal {
        bytes32 mint = t.getLaunch(id).mint;
        uint64 bal = L.balance(mint, L.pda(w));
        vm.startBroadcast(pk);
        H.approve_spl(address(t), type(uint64).max, mint);
        t.sell(id, bal / 3, 0);
        vm.stopBroadcast();
    }

    function _vault(Ledger L, address t, bytes32 mint) internal pure returns (bytes32[] memory a) {
        a = new bytes32[](8);
        a[0] = keccak256(abi.encodePacked("vault", mint));
        a[1] = L.pda(t);
        a[2] = keccak256(abi.encodePacked("token_vault", mint));
        a[3] = mint;
        a[4] = keccak256(abi.encodePacked("vault_lp_mint", mint));
        a[5] = keccak256("rent");
        a[6] = keccak256("spl-token");
        a[7] = bytes32(0);
    }

    function _pool(Ledger L, address t, bytes32 mint) internal pure returns (bytes32[] memory a) {
        a = new bytes32[](26);
        bytes32 me = L.pda(t);
        for (uint256 i; i < 26; ++i) a[i] = keccak256(abi.encodePacked("acct", mint, i));
        a[2] = mint;
        a[3] = keccak256("usdc-mint");
        a[4] = keccak256(abi.encodePacked("vault", mint));
        a[12] = L.ata(me, mint);
        a[13] = L.ata(me, keccak256("usdc-mint"));
        a[17] = me;
        a[19] = keccak256("rent");
        a[21] = keccak256("metaplex");
        a[22] = keccak256("meteora-vault");
        a[23] = keccak256("spl-token");
        a[24] = keccak256("ata");
        a[25] = bytes32(0);
    }
}
