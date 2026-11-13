// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// LOCAL UI CHECK ONLY (anvil). Deploys the Rome precompile mocks + Triumph so the web app can be
// exercised against a real (local) chain. Never used for Hadrian.
import {Script, console} from "forge-std/Script.sol";
import {Triumph} from "../src/Triumph.sol";
import {IERC20SPLFactory} from "../src/IRome.sol";
import {Ledger, MockHelper, MockCpi, MockSplCached, MockAssociatedSplCached, MockFactory} from "../test/mocks/RomeMocks.sol";

contract LocalDeploy is Script {
    function run() external {
        vm.startBroadcast();
        Ledger L = new Ledger();
        L.setEnforce(false);
        L.setPrograms(keccak256("meteora-damm"), keccak256("meteora-vault"));
        L.seedMint(keccak256("usdc-mint"));
        MockHelper h = new MockHelper(L);
        MockCpi c = new MockCpi(L);
        MockSplCached s = new MockSplCached(L);
        MockAssociatedSplCached a = new MockAssociatedSplCached(L);
        MockFactory f = new MockFactory();
        Triumph t = new Triumph(
            Triumph.Config({
                factory: IERC20SPLFactory(address(f)),
                usdcMint: keccak256("usdc-mint"),
                meteoraDamm: keccak256("meteora-damm"),
                meteoraVault: keccak256("meteora-vault"),
                metadataProgram: keccak256("metaplex"),
                tokenProgram: keccak256("spl-token"),
                ataProgram: keccak256("ata"),
                systemProgram: bytes32(0),
                rentSysvar: keccak256("rent"),
                virtualUsdc: 1_500_000,
                graduationUsdc: 3_000_000,
                poolFeeBps: 25
            })
        );
        vm.stopBroadcast();
        console.log("LEDGER", address(L));
        console.log("HELPER_IMPL", address(h));
        console.log("CPI_IMPL", address(c));
        console.log("SPL_IMPL", address(s));
        console.log("ASPL_IMPL", address(a));
        console.log("TRIUMPH", address(t));
    }
}
