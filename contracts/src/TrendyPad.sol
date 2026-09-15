// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TrendyMath as M} from "./TrendyMath.sol";
import {PoolKey, ModifyLiquidityParams, IPoolManager, IERC20R, Delta} from "./IV4.sol";

interface ITrendyTokenInit {
    function initialize(string calldata name, string calldata symbol, string calldata uri, address router, address creator) external;
}

interface ITrendyFactoryP {
    function poolManager() external view returns (IPoolManager);
    function tokenImpl() external view returns (address);
    function router() external view returns (address);
    function buyback() external view returns (address);
    function preset(uint8 curve) external view returns (int24 openTick, int24 curveTicks);
}

interface ITrendyRouterP {
    function buy(address token, uint256 minOut, address to) external payable returns (uint256);
}

/// @title Trendypad pad
/// One launchpad owned by one wallet, created by the Trendypad factory. Every token it launches trades against native
/// ETH in its own Uniswap v4 pool from the first block: 800M tokens sit on a curve range and 200M above it, both owned
/// by this contract, and there is no code path that removes liquidity, so nothing has to graduate. The pool fee is the
/// sum of the owner, creator and protocol fees. ETH fees are split between them by those shares (owner and creator
/// claim, the protocol share goes straight to the $TRENDY buyback); fees paid in the token are burned.
contract TrendyPad {
    uint256 public constant TOTAL_SUPPLY = 1e27;
    uint256 public constant CURVE_TOKENS = 8e26;
    uint256 public constant RESERVE_TOKENS = 2e26;
    int24 public constant TICK_SPACING = 200;
    int24 internal constant MAX_TICK_200 = 887200;
    uint256 public constant MAX_LAUNCH_FEE = 0.05 ether;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    ITrendyFactoryP public factory;
    IPoolManager public poolManager;
    address public owner;
    address public pendingOwner;
    string public name;
    uint16 public ownerFeeBps;
    uint16 public creatorFeeBps;
    uint16 public protocolFeeBps;
    uint8 public curve;
    uint24 public poolFee;
    uint64 public createdAt;
    uint256 public launchFee;

    struct Market {
        address token;
        address creator;
        int24 openTick;
        int24 capTick;
        uint64 createdAt;
        uint256 ethFees;
        uint256 tokenBurned;
    }

    Market[] internal _markets;
    mapping(address => uint256) public marketIndex;
    mapping(address => uint256) public claimable;

    uint256 public totalEthFees;
    uint256 public totalLaunchFees;
    uint256 public ownerEarned;
    uint256 public creatorsEarned;
    uint256 public protocolPaid;

    bool internal initialized;
    uint256 internal entered;

    event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, string metadataURI, int24 openTick, int24 capTick, uint256 devEth, uint256 devTokens);
    event FeesCollected(address indexed token, uint256 ethFees, uint256 toOwner, uint256 toCreator, uint256 toProtocol, uint256 tokenBurned);
    event Claimed(address indexed account, uint256 amount);
    event LaunchFeeSet(uint256 launchFee);
    event OwnershipTransferred(address indexed previous, address indexed next);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    modifier nonReentrant() {
        require(entered == 0, "reentry");
        entered = 1;
        _;
        entered = 0;
    }

    constructor() {
        initialized = true;
    }

    function initialize(address _owner, string calldata _name, uint16 _ownerBps, uint16 _creatorBps, uint16 _protocolBps, uint256 _launchFee, uint8 _curve) external {
        require(!initialized, "init");
        initialized = true;
        uint256 total = uint256(_ownerBps) + _creatorBps + _protocolBps;
        require(total > 0, "fee");
        factory = ITrendyFactoryP(msg.sender);
        poolManager = factory.poolManager();
        owner = _owner;
        name = _name;
        ownerFeeBps = _ownerBps;
        creatorFeeBps = _creatorBps;
        protocolFeeBps = _protocolBps;
        poolFee = uint24(total * 100);
        launchFee = _launchFee;
        curve = _curve;
        createdAt = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------- launch

    /// Launches a token. `msg.value` pays the pad's launch fee; anything above it is a first buy for the creator,
    /// guarded by `minOut`.
    function launch(string calldata tokenName, string calldata symbol, string calldata uri, uint256 minOut) external payable nonReentrant returns (address token, uint256 devTokens) {
        require(msg.value >= launchFee, "launch fee");
        uint256 nl = bytes(tokenName).length;
        uint256 sl = bytes(symbol).length;
        require(nl >= 1 && nl <= 40 && sl >= 2 && sl <= 10 && bytes(uri).length <= 300, "text");
        address router = factory.router();

        token = _clone(factory.tokenImpl());
        ITrendyTokenInit(token).initialize(tokenName, symbol, uri, router, msg.sender);
        (int24 openTick, int24 curveTicks) = factory.preset(curve);
        int24 capTick = openTick - curveTicks;
        PoolKey memory key = PoolKey(address(0), token, poolFee, TICK_SPACING, address(0));
        poolManager.initialize(key, M.sqrtAtTick(openTick));
        poolManager.unlock(abi.encode(uint8(0), key, openTick, capTick));

        uint256 left = IERC20R(token).balanceOf(address(this));
        if (left > 0) IERC20R(token).transfer(DEAD, left);

        _markets.push(Market(token, msg.sender, openTick, capTick, uint64(block.timestamp), 0, 0));
        marketIndex[token] = _markets.length;

        if (launchFee > 0) {
            claimable[owner] += launchFee;
            totalLaunchFees += launchFee;
            ownerEarned += launchFee;
        }
        uint256 devEth = msg.value - launchFee;
        if (devEth > 0) devTokens = ITrendyRouterP(router).buy{value: devEth}(token, minOut, msg.sender);
        emit TokenLaunched(token, msg.sender, tokenName, symbol, uri, openTick, capTick, devEth, devTokens);
    }

    // ---------------------------------------------------------------- fees

    /// Collects the trading fees of both positions of a token. Anyone can call it.
    function collectFees(address token) external nonReentrant returns (uint256 ethFees, uint256 tokenFees) {
        uint256 idx = marketIndex[token];
        require(idx > 0, "market");
        Market storage m = _markets[idx - 1];
        PoolKey memory key = PoolKey(address(0), token, poolFee, TICK_SPACING, address(0));
        (ethFees, tokenFees) = abi.decode(poolManager.unlock(abi.encode(uint8(1), key, m.openTick, m.capTick)), (uint256, uint256));

        uint256 total = uint256(ownerFeeBps) + creatorFeeBps + protocolFeeBps;
        uint256 toOwner = ethFees * ownerFeeBps / total;
        uint256 toCreator = ethFees * creatorFeeBps / total;
        uint256 toProtocol = ethFees - toOwner - toCreator;
        if (toOwner > 0) {
            claimable[owner] += toOwner;
            ownerEarned += toOwner;
        }
        if (toCreator > 0) {
            claimable[m.creator] += toCreator;
            creatorsEarned += toCreator;
        }
        if (toProtocol > 0) {
            address bb = factory.buyback();
            (bool ok,) = bb.call{value: toProtocol}("");
            if (!ok) claimable[bb] += toProtocol;
            protocolPaid += toProtocol;
        }
        if (tokenFees > 0) _send(token, DEAD, tokenFees);
        m.ethFees += ethFees;
        m.tokenBurned += tokenFees;
        totalEthFees += ethFees;
        emit FeesCollected(token, ethFees, toOwner, toCreator, toProtocol, tokenFees);
    }

    function claim() external nonReentrant returns (uint256) {
        return _pay(msg.sender);
    }

    /// Pays an account what it has accrued. Anyone can push it.
    function claimFor(address account) external nonReentrant returns (uint256) {
        return _pay(account);
    }

    function _pay(address account) internal returns (uint256 amount) {
        amount = claimable[account];
        if (amount == 0) return 0;
        claimable[account] = 0;
        (bool ok,) = account.call{value: amount}("");
        require(ok, "eth send");
        emit Claimed(account, amount);
    }

    receive() external payable {
        require(msg.sender == address(poolManager), "eth");
    }

    // ---------------------------------------------------------------- v4 callback

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pool manager");
        (uint8 action, PoolKey memory key, int24 openTick, int24 capTick) = abi.decode(data, (uint8, PoolKey, int24, int24));
        address token = key.currency1;
        if (action == 0) {
            uint160 s = M.sqrtAtTick(openTick);
            uint128 lc = M.liquidityFor(s, M.sqrtAtTick(capTick), s, 0, CURVE_TOKENS - 2);
            uint128 lr = M.liquidityFor(s, M.sqrtAtTick(-MAX_TICK_200), M.sqrtAtTick(capTick), 0, RESERVE_TOKENS - 2);
            (int256 d1,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(capTick, openTick, int256(uint256(lc)), bytes32(0)), "");
            (int256 d2,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(-MAX_TICK_200, capTick, int256(uint256(lr)), bytes32(0)), "");
            int256 owed = int256(Delta.amount1(d1)) + Delta.amount1(d2);
            int256 other = int256(Delta.amount0(d1)) + Delta.amount0(d2);
            require(owed < 0 && other == 0, "single sided");
            poolManager.sync(token);
            _send(token, address(poolManager), uint256(-owed));
            poolManager.settle();
            return "";
        }
        (int256 e1,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(capTick, openTick, 0, bytes32(0)), "");
        (int256 e2,) = poolManager.modifyLiquidity(key, ModifyLiquidityParams(-MAX_TICK_200, capTick, 0, bytes32(0)), "");
        int256 t0 = int256(Delta.amount0(e1)) + Delta.amount0(e2);
        int256 t1 = int256(Delta.amount1(e1)) + Delta.amount1(e2);
        uint256 f0 = t0 > 0 ? uint256(t0) : 0;
        uint256 f1 = t1 > 0 ? uint256(t1) : 0;
        if (f0 > 0) poolManager.take(address(0), address(this), f0);
        if (f1 > 0) poolManager.take(token, address(this), f1);
        return abi.encode(f0, f1);
    }

    // ---------------------------------------------------------------- owner

    function setLaunchFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_LAUNCH_FEE, "launch fee");
        launchFee = fee;
        emit LaunchFeeSet(fee);
    }

    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "pending");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- views

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarket(uint256 i) external view returns (Market memory) {
        return _markets[i];
    }

    function marketOf(address token) external view returns (Market memory m) {
        uint256 idx = marketIndex[token];
        if (idx > 0) m = _markets[idx - 1];
    }

    function markets(uint256 from, uint256 count) external view returns (Market[] memory list) {
        uint256 n = _markets.length;
        if (from >= n) return new Market[](0);
        uint256 end = from + count > n ? n : from + count;
        list = new Market[](end - from);
        for (uint256 i = from; i < end; i++) list[i - from] = _markets[i];
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        require(marketIndex[token] > 0, "market");
        return PoolKey(address(0), token, poolFee, TICK_SPACING, address(0));
    }

    // ---------------------------------------------------------------- internals

    function _send(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transfer");
    }

    function _clone(address impl) internal returns (address inst) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            inst := create(0, ptr, 0x37)
        }
        require(inst != address(0), "clone");
    }
}
