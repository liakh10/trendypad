// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TrendyMath as M} from "./TrendyMath.sol";
import {PoolKey, SwapParams, IPoolManager, Delta} from "./IV4.sol";

interface ITrendyTokenR {
    function pad() external view returns (address);
}

interface ITrendyPadR {
    function poolKeyOf(address token) external view returns (PoolKey memory);
}

interface ITrendyFactoryR {
    function isPad(address pad) external view returns (bool);
}

/// @title Trendypad router
/// Buys and sells tokens of any Trendypad pad for native ETH in one transaction through the Uniswap v4 PoolManager.
/// Sells need no approval: Trendypad tokens let this router move the caller's own tokens. `minOut` guards both sides.
/// The pools are plain v4 pools without hooks, so any other v4 router can trade them as well.
contract TrendyRouter {
    IPoolManager public immutable poolManager;
    ITrendyFactoryR public immutable factory;

    uint8 internal constant BUY = 0;
    uint8 internal constant SELL = 1;

    event Buy(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut);
    event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut);

    constructor(address _poolManager, address _factory) {
        poolManager = IPoolManager(_poolManager);
        factory = ITrendyFactoryR(_factory);
    }

    function buy(address token, uint256 minOut, address to) external payable returns (uint256 out) {
        require(msg.value > 0, "zero");
        out = abi.decode(poolManager.unlock(abi.encode(BUY, token, msg.value, minOut, msg.sender, to)), (uint256));
        emit Buy(token, to, msg.value, out);
    }

    function sell(address token, uint256 amountIn, uint256 minOut, address to) external returns (uint256 out) {
        require(amountIn > 0, "zero");
        out = abi.decode(poolManager.unlock(abi.encode(SELL, token, amountIn, minOut, msg.sender, to)), (uint256));
        emit Sell(token, msg.sender, amountIn, out);
    }

    function keyOf(address token) public view returns (PoolKey memory) {
        address pad = ITrendyTokenR(token).pad();
        require(factory.isPad(pad), "market");
        return ITrendyPadR(pad).poolKeyOf(token);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pool manager");
        (uint8 kind, address token, uint256 amountIn, uint256 minOut, address payer, address to) = abi.decode(data, (uint8, address, uint256, uint256, address, address));
        PoolKey memory key = keyOf(token);
        bool zeroForOne = kind == BUY;
        int256 d = poolManager.swap(key, SwapParams(zeroForOne, -int256(amountIn), zeroForOne ? M.MIN_SQRT + 1 : M.MAX_SQRT - 1), "");
        int128 spent = zeroForOne ? Delta.amount0(d) : Delta.amount1(d);
        int128 got = zeroForOne ? Delta.amount1(d) : Delta.amount0(d);
        require(-int256(spent) == int256(amountIn) && got > 0, "partial fill");
        uint256 out = uint256(int256(got));
        require(out >= minOut, "min out");
        if (zeroForOne) {
            poolManager.settle{value: amountIn}();
            poolManager.take(token, to, out);
        } else {
            poolManager.sync(token);
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, payer, address(poolManager), amountIn));
            require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transferFrom");
            poolManager.settle();
            poolManager.take(address(0), to, out);
        }
        return abi.encode(out);
    }
}
