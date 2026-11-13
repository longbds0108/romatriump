// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal bindings to the Rome precompiles Triumph uses. Signatures are copied
// from rome-protocol/rome-solidity `contracts/interface.sol` so the selectors match.
//
// Two precompile families must never be mixed inside one transaction
// ("one track" rule, enforced by rome-evm `verify_call`):
//   legacy / CPI track : Helper 0xff..09, CPI 0xff..08
//   cached track       : SplCached 0xff..05, AssociatedSplCached 0xff..06
// Triumph keeps every entry point on exactly one track.

interface IHelper {
    function pda(address user) external view returns (bytes32);
    function pda_with_salt(address user, bytes32 salt) external view returns (bytes32);
    function ata(address user, bytes32 mint) external view returns (bytes32);
    function swap_gas_to_lamports(uint64 lamports) external;
    function create_and_init_mint(
        uint8 decimals,
        bytes32 mintAuthority,
        bool hasFreezeAuthority,
        bytes32 freezeAuthority,
        bytes32 salt
    ) external;
    function create_ata(address user, bytes32 mint) external;
    function mint_spl(address to, uint64 amount, bytes32 mint) external;
}

interface ICpi {
    struct AccountMeta {
        bytes32 pubkey;
        bool is_signer;
        bool is_writable;
    }

    function invoke(bytes32 programId, AccountMeta[] memory accounts, bytes memory data) external;
    function account_lamports(bytes32 pubkey) external view returns (uint64);
}

interface ISplCached {
    enum AccountState {
        Uninitialized,
        Initialized,
        Frozen
    }

    struct Account {
        bytes32 mint;
        bytes32 owner;
        uint64 amount;
        bytes32 delegate;
        AccountState state;
        bool is_native;
        uint64 native_value;
        uint64 delegated_amount;
        bytes32 close_authority;
    }

    /// Moves `amount` from ata(external_auth(caller), mint) to ata(external_auth(to), mint).
    function transfer(address to, uint256 amount, bytes32 mint) external;
    /// Authority = external_auth(caller), accepted as the source ATA's owner or delegate.
    function transferFrom(address from, address to, uint256 amount, bytes32 mint) external;
    function account(address user, bytes32 mint) external view returns (Account memory);
}

interface IAssociatedSplCached {
    function create_ata(address user, bytes32 mint) external;
}

interface IERC20SPLFactory {
    function add_spl_token_no_metadata(bytes32 mint, string memory name, string memory symbol)
        external
        returns (address);
    function token_by_mint(bytes32 mint) external view returns (address);
}

library Rome {
    IHelper internal constant HELPER = IHelper(0xff00000000000000000000000000000000000009);
    ICpi internal constant CPI = ICpi(0xFF00000000000000000000000000000000000008);
    ISplCached internal constant SPL = ISplCached(0xff00000000000000000000000000000000000005);
    IAssociatedSplCached internal constant ASPL = IAssociatedSplCached(0xFF00000000000000000000000000000000000006);
}
