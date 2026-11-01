// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Plain ERC-20 with configurable decimals.
contract MockToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) ERC20("HarryPotterObamaSonic10Inu", "BITCOIN") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Token whose transfer returns nothing (USDT style). SafeERC20 must still work.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    uint8 public constant decimals = 8;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

/// Token whose transfer returns false without moving funds. SafeERC20 must revert.
contract FalseToken {
    mapping(address => uint256) public balanceOf;
    uint8 public constant decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

interface ITransferHook {
    function onTokenTransfer(uint256 amount) external;
}

/// Token that calls the recipient during transfer (ERC-777 style hook), so a
/// recipient contract can try to re-enter the cashout mid-payout.
contract HookToken is ERC20 {
    constructor() ERC20("Hook", "HOOK") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to.code.length > 0) ITransferHook(to).onTokenTransfer(value);
    }
}
