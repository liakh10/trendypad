// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "./IV4.sol";

interface ITrendyPadInit {
    function initialize(address owner, string calldata name, uint16 ownerBps, uint16 creatorBps, uint16 protocolBps, uint256 launchFee, uint8 curve) external;
}

/// @title Trendypad factory
/// Anyone creates their own launchpad in one transaction, for gas only. A pad is a minimal clone of TrendyPad owned by
/// its creator, with an owner fee (up to 5%), a creator fee (up to 3%), an optional ETH launch fee (up to 0.05 ETH) and
/// one of three curve presets. The protocol fee (at most 1%) is copied into each pad when it is created and can never
/// change for that pad. The router and the buyback can each be set once.
contract TrendyFactory {
    uint16 public constant MAX_OWNER_BPS = 500;
    uint16 public constant MAX_CREATOR_BPS = 300;
    uint16 public constant MAX_PROTOCOL_BPS = 100;
    uint256 public constant MAX_LAUNCH_FEE = 0.05 ether;
    int24 internal constant SPACING = 200;
    int24 internal constant MAX_TICK_200 = 887200;

    IPoolManager public immutable poolManager;
    address public immutable padImpl;
    address public immutable tokenImpl;
    address public owner;
    address public pendingOwner;
    address public router;
    address public buyback;
    uint16 public protocolFeeBps;

    struct Preset {
        int24 openTick;
        int24 curveTicks;
    }

    Preset[3] internal _presets;
    address[] internal _pads;
    mapping(address => bool) public isPad;
    mapping(address => address[]) internal _padsOf;

    event PadCreated(address indexed pad, address indexed owner, string name, uint16 ownerFeeBps, uint16 creatorFeeBps, uint16 protocolFeeBps, uint256 launchFee, uint8 curve);
    event RouterSet(address router);
    event BuybackSet(address buyback);
    event ProtocolFeeSet(uint16 bps);
    event OwnershipTransferred(address indexed previous, address indexed next);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    /// openTicks: tick of the opening price in tokens per ETH for each preset. curveTicks: width of the 800M curve range.
    constructor(address _poolManager, address _padImpl, address _tokenImpl, int24[3] memory openTicks, int24[3] memory curveTicks, uint16 _protocolFeeBps) {
        require(_protocolFeeBps > 0 && _protocolFeeBps <= MAX_PROTOCOL_BPS, "protocol fee");
        for (uint256 i = 0; i < 3; i++) {
            require(openTicks[i] % SPACING == 0 && curveTicks[i] % SPACING == 0 && curveTicks[i] > 0, "spacing");
            require(openTicks[i] < MAX_TICK_200 && openTicks[i] - curveTicks[i] > -MAX_TICK_200, "range");
            _presets[i] = Preset(openTicks[i], curveTicks[i]);
        }
        poolManager = IPoolManager(_poolManager);
        padImpl = _padImpl;
        tokenImpl = _tokenImpl;
        protocolFeeBps = _protocolFeeBps;
        owner = msg.sender;
    }

    function createPad(string calldata name, uint16 ownerBps, uint16 creatorBps, uint256 launchFee, uint8 curve) external returns (address pad) {
        require(router != address(0) && buyback != address(0), "not ready");
        uint256 nl = bytes(name).length;
        require(nl >= 1 && nl <= 40, "name");
        require(ownerBps <= MAX_OWNER_BPS && creatorBps <= MAX_CREATOR_BPS, "fee");
        require(launchFee <= MAX_LAUNCH_FEE, "launch fee");
        require(curve < 3, "curve");
        pad = _clone(padImpl);
        ITrendyPadInit(pad).initialize(msg.sender, name, ownerBps, creatorBps, protocolFeeBps, launchFee, curve);
        _pads.push(pad);
        isPad[pad] = true;
        _padsOf[msg.sender].push(pad);
        emit PadCreated(pad, msg.sender, name, ownerBps, creatorBps, protocolFeeBps, launchFee, curve);
    }

    // ---------------------------------------------------------------- admin

    function setRouter(address _router) external onlyOwner {
        require(router == address(0) && _router != address(0), "set");
        router = _router;
        emit RouterSet(_router);
    }

    function setBuyback(address _buyback) external onlyOwner {
        require(buyback == address(0) && _buyback != address(0), "set");
        buyback = _buyback;
        emit BuybackSet(_buyback);
    }

    /// Applies to pads created after the change only.
    function setProtocolFee(uint16 bps) external onlyOwner {
        require(bps > 0 && bps <= MAX_PROTOCOL_BPS, "protocol fee");
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
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

    function preset(uint8 curve) external view returns (int24 openTick, int24 curveTicks) {
        Preset memory p = _presets[curve];
        return (p.openTick, p.curveTicks);
    }

    function padCount() external view returns (uint256) {
        return _pads.length;
    }

    function pads(uint256 from, uint256 count) external view returns (address[] memory list) {
        uint256 n = _pads.length;
        if (from >= n) return new address[](0);
        uint256 end = from + count > n ? n : from + count;
        list = new address[](end - from);
        for (uint256 i = from; i < end; i++) list[i - from] = _pads[i];
    }

    function padsOf(address who) external view returns (address[] memory) {
        return _padsOf[who];
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
