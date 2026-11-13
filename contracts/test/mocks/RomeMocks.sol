// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICpi, ISplCached} from "../../src/IRome.sol";

/// Shared Solana-side state behind the etched precompile mocks. Pubkeys are fake
/// (keccak-derived) but deterministic, and SPL semantics that matter to Triumph are
/// modelled: ATAs must exist, delegates are checked, balances can't go negative,
/// mint authority is enforced, and the one-track rule is enforced per "transaction".
contract Ledger {
    enum Track {
        None,
        Legacy,
        Cached
    }

    Track public track;
    bool public enforce = true; // one-track rule; off for a long-lived local chain (no per-tx reset there)

    function setEnforce(bool on) external {
        enforce = on;
    }
    mapping(bytes32 => bool) public mintExists;
    mapping(bytes32 => bytes32) public mintAuthority;
    mapping(bytes32 => uint64) public supply;
    mapping(bytes32 => mapping(bytes32 => bool)) public ataExists; // mint => owner => exists
    mapping(bytes32 => mapping(bytes32 => uint64)) public balance; // mint => owner => amount
    mapping(bytes32 => mapping(bytes32 => bytes32)) public delegateOf;
    mapping(bytes32 => mapping(bytes32 => uint64)) public delegated;
    mapping(bytes32 => uint64) public lamports;
    uint256 public gasLamportsBilled;

    // last CPI
    bytes32 public lastProgram;
    bytes public lastData;
    ICpi.AccountMeta[] internal _lastMetas;
    uint256 public invokeCount;

    bytes32 public meteoraDamm;
    bytes32 public meteoraVault;

    function setPrograms(bytes32 damm, bytes32 vault) external {
        meteoraDamm = damm;
        meteoraVault = vault;
    }

    function newTx() external {
        track = Track.None;
    }

    function check(Track t) external view {
        if (!enforce) return;
        require(track == Track.None || track == t, "attempt to use cpi-cached program with cpi-program");
    }

    function use(Track t) public {
        if (!enforce) return;
        if (track == Track.None) track = t;
        require(track == t, "attempt to use cpi-cached program with cpi-program");
    }

    // ── derivations ──
    function pda(address user) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("pda", user));
    }

    function pdaWithSalt(address user, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("pda_salt", user, salt));
    }

    function ata(bytes32 owner, bytes32 mint) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("ata", owner, mint));
    }

    // ── state ops (called by the mocks) ──
    function createMint(bytes32 mint, bytes32 authority) external {
        require(!mintExists[mint], "mint exists");
        mintExists[mint] = true;
        mintAuthority[mint] = authority;
    }

    function createAta(bytes32 owner, bytes32 mint) public {
        require(mintExists[mint], "no mint");
        ataExists[mint][owner] = true;
    }

    function mintTo(bytes32 signer, bytes32 owner, bytes32 mint, uint64 amount) external {
        require(mintAuthority[mint] == signer, "mint authority");
        require(ataExists[mint][owner], "ata missing");
        balance[mint][owner] += amount;
        supply[mint] += amount;
    }

    function move(bytes32 authority, bytes32 from, bytes32 to, bytes32 mint, uint64 amount) public {
        require(ataExists[mint][from], "src ata missing");
        require(ataExists[mint][to], "dst ata missing");
        if (authority != from) {
            require(delegateOf[mint][from] == authority, "0x4 owner does not match");
            require(delegated[mint][from] >= amount, "0x1 insufficient delegated");
            delegated[mint][from] -= amount;
        }
        require(balance[mint][from] >= amount, "0x1 insufficient funds");
        balance[mint][from] -= amount;
        balance[mint][to] += amount;
    }

    function approve(bytes32 owner, bytes32 delegate_, bytes32 mint, uint64 amount) external {
        require(ataExists[mint][owner], "ata missing");
        delegateOf[mint][owner] = delegate_;
        delegated[mint][owner] = amount;
    }

    function addLamports(bytes32 who, uint64 amount) external {
        lamports[who] += amount;
        gasLamportsBilled += amount;
    }

    function spendLamports(bytes32 who, uint64 amount) public {
        require(lamports[who] >= amount, "Custom(1) rent");
        lamports[who] -= amount;
    }

    // ── test seeding ──
    function seedMint(bytes32 mint) external {
        mintExists[mint] = true;
    }

    function seed(bytes32 owner, bytes32 mint, uint64 amount) external {
        ataExists[mint][owner] = true;
        balance[mint][owner] += amount;
    }

    // ── CPI simulation ──
    function recordInvoke(bytes32 signerPda, bytes32 program, ICpi.AccountMeta[] calldata metas, bytes calldata data)
        external
    {
        lastProgram = program;
        lastData = data;
        delete _lastMetas;
        for (uint256 i; i < metas.length; ++i) {
            _lastMetas.push(metas[i]);
            if (metas[i].is_signer) require(metas[i].pubkey == signerPda, "signer is not caller pda");
        }
        invokeCount++;

        if (program == meteoraVault) {
            require(metas.length == 8, "vault metas");
            require(lamports[metas[0].pubkey] == 0, "vault already in use");
            spendLamports(signerPda, 9_470_000); // vault + token_vault + lp_mint (devnet)
            lamports[metas[0].pubkey] = 1;
        } else if (program == meteoraDamm) {
            require(metas.length == 26, "pool metas");
            require(lamports[metas[4].pubkey] != 0, "a_vault missing");
            require(lamports[metas[0].pubkey] == 0, "pool exists");
            uint64 a = _u64At(data, 17);
            uint64 b = _u64At(data, 25);
            bytes32 pool = metas[0].pubkey;
            bytes32 mintA = metas[2].pubkey;
            bytes32 mintB = metas[3].pubkey;
            require(metas[12].pubkey == ata(signerPda, mintA), "payer_token_a");
            require(metas[13].pubkey == ata(signerPda, mintB), "payer_token_b");
            ataExists[mintA][pool] = true;
            ataExists[mintB][pool] = true;
            move(signerPda, signerPda, pool, mintA, a);
            move(signerPda, signerPda, pool, mintB, b);
            spendLamports(signerPda, 18_100_000); // pool accounts + LP metadata (devnet estimate)
            lamports[pool] = 1;
            // LP minted to the payer's LP ATA
            bytes32 lpMint = metas[1].pubkey;
            mintExists[lpMint] = true;
            ataExists[lpMint][signerPda] = true;
            balance[lpMint][signerPda] += 1_000_000;
        } else {
            revert("unknown program");
        }
    }

    function lastMeta(uint256 i) external view returns (ICpi.AccountMeta memory) {
        return _lastMetas[i];
    }

    function lastMetaCount() external view returns (uint256) {
        return _lastMetas.length;
    }

    function _u64At(bytes calldata d, uint256 off) internal pure returns (uint64 v) {
        for (uint256 i; i < 8; ++i) v |= uint64(uint8(d[off + i])) << uint64(8 * i);
    }
}

abstract contract LedgerRef {
    Ledger internal immutable L;

    constructor(Ledger l) {
        L = l;
    }
}

/// Etched at 0xff..09
contract MockHelper is LedgerRef {
    constructor(Ledger l) LedgerRef(l) {}

    function pda(address user) external view returns (bytes32) {
        return L.pda(user);
    }

    function pda_with_salt(address user, bytes32 salt) external view returns (bytes32) {
        return L.pdaWithSalt(user, salt);
    }

    function ata(address user, bytes32 mint) external view returns (bytes32) {
        return L.ata(L.pda(user), mint);
    }

    function swap_gas_to_lamports(uint64 lamports) external {
        L.use(Ledger.Track.Legacy);
        L.addLamports(L.pda(msg.sender), lamports);
    }

    function create_and_init_mint(uint8, bytes32 authority, bool, bytes32, bytes32 salt) external {
        L.use(Ledger.Track.Legacy);
        bytes32 payer = L.pda(msg.sender);
        L.spendLamports(payer, 1_066_800); // devnet rent, 82-byte mint
        L.createMint(L.pdaWithSalt(msg.sender, salt), authority);
    }

    function create_ata(address user, bytes32 mint) external {
        L.use(Ledger.Track.Legacy);
        L.spendLamports(L.pda(msg.sender), 1_488_440); // devnet rent, 165-byte token account
        L.createAta(L.pda(user), mint);
    }

    function mint_spl(address to, uint64 amount, bytes32 mint) external {
        L.use(Ledger.Track.Legacy);
        L.mintTo(L.pda(msg.sender), L.pda(to), mint, amount);
    }

    function user_balance(address account, bytes32 mint) external view returns (uint64) {
        return L.balance(mint, L.pda(account));
    }

    function allowance_of(address owner, address spender, bytes32 mint) external view returns (uint64) {
        bytes32 o = L.pda(owner);
        return L.delegateOf(mint, o) == L.pda(spender) ? L.delegated(mint, o) : 0;
    }

    function approve_spl(address spender, uint64 amount, bytes32 mint) external {
        L.use(Ledger.Track.Legacy);
        L.approve(L.pda(msg.sender), L.pda(spender), mint, amount);
    }
}

/// Etched at 0xff..08
contract MockCpi is LedgerRef {
    constructor(Ledger l) LedgerRef(l) {}

    function account_lamports(bytes32 pubkey) external view returns (uint64) {
        L.check(Ledger.Track.Legacy);
        return L.lamports(pubkey);
    }

    function invoke(bytes32 program, ICpi.AccountMeta[] calldata metas, bytes calldata data) external {
        L.use(Ledger.Track.Legacy);
        require(metas.length > 0, "empty accounts");
        L.recordInvoke(L.pda(msg.sender), program, metas, data);
    }
}

/// Etched at 0xff..05
contract MockSplCached is LedgerRef {
    constructor(Ledger l) LedgerRef(l) {}

    function transfer(address to, uint256 amount, bytes32 mint) external {
        L.use(Ledger.Track.Cached);
        bytes32 me = L.pda(msg.sender);
        L.move(me, me, L.pda(to), mint, uint64(amount));
    }

    function transferFrom(address from, address to, uint256 amount, bytes32 mint) external {
        L.use(Ledger.Track.Cached);
        L.move(L.pda(msg.sender), L.pda(from), L.pda(to), mint, uint64(amount));
    }

    function account(address user, bytes32 mint) external view returns (ISplCached.Account memory a) {
        L.check(Ledger.Track.Cached);
        bytes32 owner = L.pda(user);
        require(L.ataExists(mint, owner), "AccountNotFound");
        a.mint = mint;
        a.owner = owner;
        a.amount = L.balance(mint, owner);
    }
}

/// Etched at 0xff..06
contract MockAssociatedSplCached is LedgerRef {
    constructor(Ledger l) LedgerRef(l) {}

    function create_ata(address user, bytes32 mint) external {
        L.use(Ledger.Track.Cached);
        L.createAta(L.pda(user), mint);
    }
}

contract MockWrapper {
    bytes32 public mint_id;
    string public name;
    string public symbol;

    constructor(bytes32 m, string memory n, string memory s) {
        mint_id = m;
        name = n;
        symbol = s;
    }
}

contract MockFactory {
    mapping(bytes32 => address) public token_by_mint;
    mapping(bytes32 => bool) internal _sym;

    function add_spl_token_no_metadata(bytes32 mint, string memory name, string memory symbol)
        external
        returns (address w)
    {
        require(token_by_mint[mint] == address(0), "Token exists");
        bytes32 h = keccak256(bytes(symbol));
        require(!_sym[h], "Token with symbol exists");
        _sym[h] = true;
        w = address(new MockWrapper(mint, name, symbol));
        token_by_mint[mint] = w;
    }
}
