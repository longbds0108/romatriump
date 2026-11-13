// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Rome, ICpi, ISplCached, IERC20SPLFactory} from "./IRome.sol";

/// @title  Triumph — a graduation launchpad on Rome.
/// @notice Each launch mints a real SPL token on Solana with a fixed supply. Part of it
///         sells on a constant-product bonding curve priced in USDC; the rest is reserved.
///         When the curve sells out, trading stops and anyone can graduate the launch: one
///         transaction CPIs into Meteora DAMM v1 on Solana, opening a TOKEN/USDC pool seeded
///         with every USDC the curve raised and the reserve, at exactly the curve's final
///         price. The pool's LP tokens stay in this contract's PDA forever (there is no code
///         path that moves them), so liquidity is locked by construction.
///
///         MetaMask users and Solana-wallet users (via their Rome synthetic address) call the
///         same functions and trade against the same curve.
///
/// @dev    Rome rule: a transaction must stay on one precompile track. Every entry point here
///         is single-track:
///           legacy/CPI : launch, initTokenVault, graduate, registerWrapper (no SPL moves)
///           cached     : buy, sell, withdrawFees
///         Holdings live in SPL token accounts owned by this contract's PDA
///         (`Helper.pda(address(this))`), never in ERC-20 wrapper escrow, because Meteora
///         needs the PDA to sign for the deposit.
contract Triumph {
    // ─── Types ────────────────────────────────────────────────────────────────────────────

    enum Status {
        None,
        Trading, // curve open
        Completed, // curve sold out; trading halted; waiting for graduation
        Graduated // Meteora pool live; LP locked here
    }

    struct Launch {
        bytes32 mint; // SPL mint (Solana pubkey)
        address creator;
        uint64 createdAt;
        Status status;
        uint64 sold; // curve tokens sold (raw units)
        uint64 raised; // USDC held for this curve (raw 6-dec units, fees excluded)
        address wrapper; // ERC-20 wrapper from ERC20SPLFactory, 0 until registered
        bool vaultReady; // Meteora dynamic-vault exists for the mint
        bytes32 pool; // Meteora pool, 0 until graduated
        bytes32 lpMint;
        string name;
        string symbol;
    }

    // ─── Constants ────────────────────────────────────────────────────────────────────────

    uint8 public constant DECIMALS = 6;
    uint64 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e6; // fits u64 (1e15)
    uint256 public constant TRADE_FEE_BPS = 100; // 1% on curve trades, to the protocol
    uint64 internal constant PDA_MIN_LAMPORTS = 890_880; // rent floor of a 0-byte system account

    /// sha256("global:initialize_permissionless_pool_with_fee_tier")[0..8]
    bytes8 internal constant POOL_INIT_DISC = 0x06874493e552a971;
    /// sha256("global:initialize")[0..8] — Meteora dynamic-vault
    bytes8 internal constant VAULT_INIT_DISC = 0xafaf6d1f0d989bed;

    uint256 internal constant POOL_ACCOUNTS = 26;
    uint256 internal constant VAULT_ACCOUNTS = 8;

    // ─── Immutable configuration (resolved from the Rome registry at deploy) ───────────────

    IERC20SPLFactory public immutable factory;
    bytes32 public immutable usdcMint;
    bytes32 public immutable meteoraDamm;
    bytes32 public immutable meteoraVault;
    bytes32 public immutable metadataProgram;
    bytes32 public immutable tokenProgram;
    bytes32 public immutable ataProgram;
    bytes32 public immutable systemProgram;
    bytes32 public immutable rentSysvar;

    /// Curve shape. `virtualUsdc` sets the starting price; the curve completes when
    /// `graduationUsdc` has been raised. Both raw 6-decimal USDC.
    uint64 public immutable virtualUsdc;
    uint64 public immutable graduationUsdc;
    /// Tokens sold on the curve, and the reserve paired with the raise in the pool.
    uint64 public immutable curveSupply;
    uint64 public immutable lpSupply;
    /// Virtual token reserve at t=0 and the invariant k = virtualUsdc * virtualTokens0.
    uint256 public immutable virtualTokens0;
    uint256 public immutable k;
    /// Meteora fee tier for graduated pools (bps).
    uint64 public immutable poolFeeBps;

    // ─── State ────────────────────────────────────────────────────────────────────────────

    address public owner;
    uint64 public protocolFees; // USDC raw units, held in this contract's PDA ATA
    bool public usdcAccountReady; // this PDA's USDC token account exists
    /// Lamport budgets for the Solana accounts each step creates (billed to the caller in gas).
    uint64 public launchRent = 5_000_000;
    uint64 public vaultRent = 10_000_000;
    uint64 public poolRent = 22_000_000;

    Launch[] internal _launches;
    mapping(bytes32 => uint256) public launchIdByMint; // id + 1
    mapping(bytes32 => bool) public symbolTaken;

    // ─── Events ───────────────────────────────────────────────────────────────────────────

    event Launched(uint256 indexed id, bytes32 indexed mint, address indexed creator, string name, string symbol);
    event Trade(
        uint256 indexed id,
        address indexed trader,
        bool isBuy,
        uint256 usdc,
        uint256 tokens,
        uint256 fee,
        uint64 sold,
        uint64 raised
    );
    event CurveCompleted(uint256 indexed id, uint64 raised);
    event WrapperRegistered(uint256 indexed id, address wrapper);
    event TokenVaultReady(uint256 indexed id, bytes32 vault);
    event Graduated(uint256 indexed id, bytes32 pool, bytes32 lpMint, uint64 usdc, uint64 tokens, address caller);
    event FeesWithdrawn(address indexed to, uint64 amount);
    event RentBudgetsSet(uint64 launchRent, uint64 vaultRent, uint64 poolRent);
    event OwnerChanged(address indexed owner);

    // ─── Errors ───────────────────────────────────────────────────────────────────────────

    error NotOwner();
    error BadLaunch();
    error WrongStatus(Status have);
    error BadName();
    error SymbolTaken();
    error ZeroAmount();
    error Slippage(uint256 got, uint256 min);
    error ExceedsReserve();
    error BadAccounts(uint256 index);
    error VaultMissing();
    error CallFailed(bytes reason);

    struct Config {
        IERC20SPLFactory factory;
        bytes32 usdcMint;
        bytes32 meteoraDamm;
        bytes32 meteoraVault;
        bytes32 metadataProgram;
        bytes32 tokenProgram;
        bytes32 ataProgram;
        bytes32 systemProgram;
        bytes32 rentSysvar;
        uint64 virtualUsdc;
        uint64 graduationUsdc;
        uint64 poolFeeBps;
    }

    constructor(Config memory c) {
        if (c.virtualUsdc == 0 || c.graduationUsdc == 0) revert ZeroAmount();
        factory = c.factory;
        usdcMint = c.usdcMint;
        meteoraDamm = c.meteoraDamm;
        meteoraVault = c.meteoraVault;
        metadataProgram = c.metadataProgram;
        tokenProgram = c.tokenProgram;
        ataProgram = c.ataProgram;
        systemProgram = c.systemProgram;
        rentSysvar = c.rentSysvar;
        virtualUsdc = c.virtualUsdc;
        graduationUsdc = c.graduationUsdc;
        poolFeeBps = c.poolFeeBps;

        // Split the supply so the pool opens at the curve's final price:
        //   curve C = S(V+R)/(2V+R), reserve L = S - C = S·V/(2V+R)
        //   virtual tokens Y0 = C(V+R)/R, k = V·Y0
        //   end price (V+R)/(Y0-C) = R(2V+R)/(S·V) = R/L  (pool price)
        uint256 S = TOTAL_SUPPLY;
        uint256 V = c.virtualUsdc;
        uint256 R = c.graduationUsdc;
        uint256 C = (S * (V + R)) / (2 * V + R);
        curveSupply = uint64(C);
        lpSupply = uint64(S - C);
        virtualTokens0 = (C * (V + R)) / R;
        k = V * virtualTokens0;

        owner = msg.sender;
        emit OwnerChanged(msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─── Views ────────────────────────────────────────────────────────────────────────────

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 id) external view returns (Launch memory) {
        return _get(id);
    }

    /// This contract's Solana identity: signs every CPI and owns every holding.
    function vaultAuthority() public view returns (bytes32) {
        return Rome.HELPER.pda(address(this));
    }

    /// Mint address the next launch will get.
    function nextMint() external view returns (bytes32) {
        return Rome.HELPER.pda_with_salt(address(this), _salt(_launches.length));
    }

    /// Current price as a fraction: USDC raw per token raw = num/den.
    function spotPrice(uint256 id) external view returns (uint256 num, uint256 den) {
        Launch storage l = _get(id);
        return (uint256(virtualUsdc) + l.raised, virtualTokens0 - l.sold);
    }

    /// Tokens out for `usdcIn` gross; also returns the USDC actually charged (the last buy is capped).
    function quoteBuy(uint256 id, uint256 usdcIn) public view returns (uint256 tokensOut, uint256 charged, uint256 fee) {
        Launch storage l = _get(id);
        if (l.status != Status.Trading) revert WrongStatus(l.status);
        (tokensOut, charged, fee,) = _buyMath(l, usdcIn);
    }

    /// USDC out (net of fee) for selling `tokensIn`.
    function quoteSell(uint256 id, uint256 tokensIn) public view returns (uint256 usdcOut, uint256 fee) {
        Launch storage l = _get(id);
        if (l.status != Status.Trading) revert WrongStatus(l.status);
        (usdcOut, fee) = _sellMath(l, tokensIn);
    }

    // ─── Launch (legacy track) ────────────────────────────────────────────────────────────

    /// Creates the SPL mint (authority = this PDA), its token account, and mints the full
    /// fixed supply into it. Rent for the new accounts is billed to the caller as gas.
    function launch(string calldata name, string calldata symbol) external returns (uint256 id, bytes32 mint) {
        uint256 nl = bytes(name).length;
        uint256 sl = bytes(symbol).length;
        if (nl == 0 || nl > 32 || sl == 0 || sl > 10) revert BadName();
        bytes32 symHash = keccak256(bytes(symbol));
        if (symbolTaken[symHash]) revert SymbolTaken();
        symbolTaken[symHash] = true;

        id = _launches.length;
        bytes32 salt = _salt(id);
        bytes32 authority = vaultAuthority();
        mint = Rome.HELPER.pda_with_salt(address(this), salt);

        _ensureLamports(launchRent);
        _call(
            address(Rome.HELPER),
            abi.encodeCall(Rome.HELPER.create_and_init_mint, (DECIMALS, authority, false, bytes32(0), salt))
        );
        _call(address(Rome.HELPER), abi.encodeCall(Rome.HELPER.create_ata, (address(this), mint)));
        _call(address(Rome.HELPER), abi.encodeCall(Rome.HELPER.mint_spl, (address(this), TOTAL_SUPPLY, mint)));
        if (!usdcAccountReady) {
            // First launch also opens the USDC account every curve's raise is held in.
            _call(address(Rome.HELPER), abi.encodeCall(Rome.HELPER.create_ata, (address(this), usdcMint)));
            usdcAccountReady = true;
        }

        Launch storage l = _launches.push();
        l.mint = mint;
        l.creator = msg.sender;
        l.createdAt = uint64(block.timestamp);
        l.status = Status.Trading;
        l.name = name;
        l.symbol = symbol;
        launchIdByMint[mint] = id + 1;

        emit Launched(id, mint, msg.sender, name, symbol);
    }

    /// Deploys the ERC-20 wrapper for a launch's mint through Rome's ERC20SPLFactory, so the
    /// token shows up as an ordinary ERC-20 in EVM wallets. Separate tx: a contract deploy is
    /// large and must not share a transaction with CPI work.
    function registerWrapper(uint256 id) external returns (address wrapper) {
        Launch storage l = _get(id);
        if (l.wrapper != address(0)) return l.wrapper;
        wrapper = factory.token_by_mint(l.mint);
        if (wrapper == address(0)) wrapper = factory.add_spl_token_no_metadata(l.mint, l.name, l.symbol);
        l.wrapper = wrapper;
        emit WrapperRegistered(id, wrapper);
    }

    // ─── Curve (cached track) ─────────────────────────────────────────────────────────────

    /// Buy with up to `usdcIn` (raw 6-dec). The caller must have made this contract the SPL
    /// delegate of their USDC account once: Helper.approve_spl(this, 2^64-1, usdcMint).
    function buy(uint256 id, uint256 usdcIn, uint256 minTokensOut) external returns (uint256 tokensOut) {
        Launch storage l = _get(id);
        if (l.status != Status.Trading) revert WrongStatus(l.status);
        if (usdcIn == 0) revert ZeroAmount();

        uint256 charged;
        uint256 fee;
        bool completes;
        (tokensOut, charged, fee, completes) = _buyMath(l, usdcIn);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert Slippage(tokensOut, minTokensOut);

        l.sold += uint64(tokensOut);
        l.raised += uint64(charged - fee);
        protocolFees += uint64(fee);
        if (completes) l.status = Status.Completed;

        _splCall(abi.encodeCall(ISplCached.transferFrom, (msg.sender, address(this), charged, usdcMint)));
        _ensureAta(msg.sender, l.mint);
        _splCall(abi.encodeCall(ISplCached.transfer, (msg.sender, tokensOut, l.mint)));

        emit Trade(id, msg.sender, true, charged, tokensOut, fee, l.sold, l.raised);
        if (completes) emit CurveCompleted(id, l.raised);
    }

    /// Sell `tokensIn` back to the curve. The caller must have made this contract the SPL
    /// delegate of their token account once: Helper.approve_spl(this, 2^64-1, mint).
    function sell(uint256 id, uint256 tokensIn, uint256 minUsdcOut) external returns (uint256 usdcOut) {
        Launch storage l = _get(id);
        if (l.status != Status.Trading) revert WrongStatus(l.status);
        if (tokensIn == 0) revert ZeroAmount();

        uint256 fee;
        (usdcOut, fee) = _sellMath(l, tokensIn);
        if (usdcOut == 0 || usdcOut < minUsdcOut) revert Slippage(usdcOut, minUsdcOut);

        l.sold -= uint64(tokensIn);
        l.raised -= uint64(usdcOut + fee);
        protocolFees += uint64(fee);

        _splCall(abi.encodeCall(ISplCached.transferFrom, (msg.sender, address(this), tokensIn, l.mint)));
        _ensureAta(msg.sender, usdcMint);
        _splCall(abi.encodeCall(ISplCached.transfer, (msg.sender, usdcOut, usdcMint)));

        emit Trade(id, msg.sender, false, usdcOut, tokensIn, fee, l.sold, l.raised);
    }

    // ─── Graduation (legacy track) ────────────────────────────────────────────────────────

    /// Initializes the Meteora dynamic-vault for a launch's mint (Meteora needs one per mint
    /// before a pool can use it). Permissionless and idempotent. Accounts, in the vault
    /// program's `Initialize` order: vault, payer, token_vault, token_mint, lp_mint, rent,
    /// token_program, system_program. PDA seeds are checked by the vault program itself.
    function initTokenVault(uint256 id, bytes32[] calldata accts) external {
        Launch storage l = _get(id);
        if (l.vaultReady) return;
        if (accts.length != VAULT_ACCOUNTS) revert BadAccounts(accts.length);
        if (Rome.CPI.account_lamports(accts[0]) != 0) {
            l.vaultReady = true;
            emit TokenVaultReady(id, accts[0]);
            return;
        }
        bytes32 authority = vaultAuthority();
        _expect(accts, 1, authority);
        _expect(accts, 3, l.mint);
        _expect(accts, 5, rentSysvar);
        _expect(accts, 6, tokenProgram);
        _expect(accts, 7, systemProgram);

        ICpi.AccountMeta[] memory metas = new ICpi.AccountMeta[](VAULT_ACCOUNTS);
        for (uint256 i; i < VAULT_ACCOUNTS; ++i) {
            metas[i] = ICpi.AccountMeta(accts[i], i == 1, i == 0 || i == 1 || i == 2 || i == 4);
        }
        _ensureLamports(vaultRent);
        _call(address(Rome.CPI), abi.encodeCall(ICpi.invoke, (meteoraVault, metas, abi.encodePacked(VAULT_INIT_DISC))));
        l.vaultReady = true;
        emit TokenVaultReady(id, accts[0]);
    }

    /// Opens the Meteora DAMM v1 TOKEN/USDC pool with all raised USDC and the reserve, in one
    /// CPI. Permissionless once the curve completes. `accts` is the 26-account list of
    /// `initialize_permissionless_pool_with_fee_tier`, token A = launch mint, token B = USDC.
    /// Every account that could redirect value or signer privilege is pinned here; the rest
    /// are PDAs whose seeds Meteora verifies.
    function graduate(uint256 id, bytes32[] calldata accts) external {
        Launch storage l = _get(id);
        if (l.status != Status.Completed) revert WrongStatus(l.status);
        if (!l.vaultReady) revert VaultMissing();
        if (accts.length != POOL_ACCOUNTS) revert BadAccounts(accts.length);

        bytes32 authority = vaultAuthority();
        _expect(accts, 2, l.mint);
        _expect(accts, 3, usdcMint);
        _expect(accts, 12, Rome.HELPER.ata(address(this), l.mint));
        _expect(accts, 13, Rome.HELPER.ata(address(this), usdcMint));
        _expect(accts, 17, authority);
        _expect(accts, 19, rentSysvar);
        _expect(accts, 21, metadataProgram);
        _expect(accts, 22, meteoraVault);
        _expect(accts, 23, tokenProgram);
        _expect(accts, 24, ataProgram);
        _expect(accts, 25, systemProgram);

        ICpi.AccountMeta[] memory metas = new ICpi.AccountMeta[](POOL_ACCOUNTS);
        for (uint256 i; i < POOL_ACCOUNTS; ++i) {
            // read-only: token mints, fee_owner, rent and the five programs
            bool ro = i == 2 || i == 3 || i == 18 || i == 19 || i >= 21;
            metas[i] = ICpi.AccountMeta(accts[i], i == 17, !ro);
        }

        uint64 tokens = lpSupply;
        uint64 usdc = l.raised;
        bytes memory data = abi.encodePacked(
            POOL_INIT_DISC, uint8(0), _u64le(poolFeeBps), _u64le(tokens), _u64le(usdc)
        );

        l.status = Status.Graduated;
        l.pool = accts[0];
        l.lpMint = accts[1];
        l.raised = 0;

        _ensureLamports(poolRent);
        _call(address(Rome.CPI), abi.encodeCall(ICpi.invoke, (meteoraDamm, metas, data)));

        emit Graduated(id, accts[0], accts[1], usdc, tokens, msg.sender);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────────────

    /// Cached track: moves only accrued protocol fees, never curve USDC.
    function withdrawFees(address to) external onlyOwner {
        uint64 amount = protocolFees;
        if (amount == 0) revert ZeroAmount();
        protocolFees = 0;
        _ensureAta(to, usdcMint);
        _splCall(abi.encodeCall(ISplCached.transfer, (to, uint256(amount), usdcMint)));
        emit FeesWithdrawn(to, amount);
    }

    function setRentBudgets(uint64 launch_, uint64 vault_, uint64 pool_) external onlyOwner {
        launchRent = launch_;
        vaultRent = vault_;
        poolRent = pool_;
        emit RentBudgetsSet(launch_, vault_, pool_);
    }

    function setOwner(address next) external onlyOwner {
        owner = next;
        emit OwnerChanged(next);
    }

    // ─── Internals ────────────────────────────────────────────────────────────────────────

    function _get(uint256 id) internal view returns (Launch storage) {
        if (id >= _launches.length) revert BadLaunch();
        return _launches[id];
    }

    function _salt(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("triumph.mint", address(this), id));
    }

    function _buyMath(Launch storage l, uint256 usdcIn)
        internal
        view
        returns (uint256 tokensOut, uint256 charged, uint256 fee, bool completes)
    {
        uint256 remaining = uint256(graduationUsdc) - l.raised;
        uint256 net = (usdcIn * (10_000 - TRADE_FEE_BPS)) / 10_000;
        if (net >= remaining) {
            // Final buy: take exactly what completes the curve and hand over every token left.
            net = remaining;
            fee = _ceilDiv(net * TRADE_FEE_BPS, 10_000 - TRADE_FEE_BPS);
            charged = net + fee;
            tokensOut = uint256(curveSupply) - l.sold;
            completes = true;
        } else {
            fee = usdcIn - net;
            charged = usdcIn;
            uint256 x = uint256(virtualUsdc) + l.raised;
            uint256 y = virtualTokens0 - l.sold;
            // Round the new reserve up so rounding favours the curve.
            tokensOut = y - _ceilDiv(k, x + net);
            uint256 left = uint256(curveSupply) - l.sold;
            if (tokensOut > left) tokensOut = left;
        }
    }

    function _sellMath(Launch storage l, uint256 tokensIn) internal view returns (uint256 usdcOut, uint256 fee) {
        if (tokensIn > l.sold) revert ExceedsReserve();
        uint256 x = uint256(virtualUsdc) + l.raised;
        uint256 y = virtualTokens0 - l.sold;
        uint256 gross = x - _ceilDiv(k, y + tokensIn);
        if (gross > l.raised) gross = l.raised;
        fee = _ceilDiv(gross * TRADE_FEE_BPS, 10_000);
        usdcOut = gross - fee;
    }

    function _ensureLamports(uint64 budget) internal {
        uint64 need = PDA_MIN_LAMPORTS + budget;
        uint64 have = Rome.CPI.account_lamports(vaultAuthority());
        if (have < need) {
            _call(address(Rome.HELPER), abi.encodeCall(Rome.HELPER.swap_gas_to_lamports, (need - have)));
        }
    }

    function _ensureAta(address user, bytes32 mint) internal {
        try Rome.SPL.account(user, mint) returns (ISplCached.Account memory) {}
        catch {
            _call(address(Rome.ASPL), abi.encodeWithSignature("create_ata(address,bytes32)", user, mint));
        }
    }

    function _splCall(bytes memory data) internal {
        _call(address(Rome.SPL), data);
    }

    function _call(address target, bytes memory data) internal {
        (bool ok, bytes memory res) = target.call(data);
        if (!ok) revert CallFailed(res);
    }

    function _expect(bytes32[] calldata accts, uint256 i, bytes32 want) internal pure {
        if (accts[i] != want) revert BadAccounts(i);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _u64le(uint64 v) internal pure returns (bytes8) {
        uint64 r = ((v & 0xFF) << 56) | ((v & 0xFF00) << 40) | ((v & 0xFF0000) << 24) | ((v & 0xFF000000) << 8)
            | ((v >> 8) & 0xFF000000) | ((v >> 24) & 0xFF0000) | ((v >> 40) & 0xFF00) | (v >> 56);
        return bytes8(r);
    }
}
