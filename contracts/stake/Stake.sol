pragma solidity ^0.6.12;

import "../openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "../openzeppelin-contracts/contracts/math/SafeMath.sol";
import "../openzeppelin-contracts/contracts/access/Ownable.sol";

contract Stake is Ownable {
  using SafeMath for uint256;

  // stake program time
  uint256 public start;
  uint256 public duration;
  uint256 public end;
  uint256 public totalX;

  // UNI pool token
  IERC20 public stakeToken;
  // reward token
  IERC20 public rewardToken;

  // shares
  uint256 public totalSupply;
  uint256 public bonusSupply;

  // stake
  uint256 public totalStaked;

  // Denomination of initial shares
  uint256 constant private INITIAL_SHARES = 10 ** 18;

  // user shares balance
  mapping(address => uint256) public balanceOf;
  // user stake token balance
  mapping(address => uint256) public stakesOf;

  // events
  event Staked(address indexed user, uint256 amount, uint256 totalSupply);
  event Unstaked(address indexed user, uint256 amount, uint256 totalSupply);
  event EmergencyWithdraw(address indexed user, uint256 amount, uint256 totalSupply);


  /**
  * @dev constructor
  *
  * @param _stakeToken   UNI pool token
  * @param _rewardToken  reward token
  * @param _duration     stake program time
  * @param _totalX       bonus %
  */
  constructor(
    address _stakeToken,
    address _rewardToken,
    uint256 _duration,
    uint256 _totalX
  )
  public
  {
    stakeToken = IERC20(_stakeToken);
    rewardToken = IERC20(_rewardToken);
    duration = _duration;
    totalX = _totalX;
    start = now;
    end = now + _duration;
  }

  /**
  * @dev lock stake tokens for a stake period
  *
  * @param _stakeTokenAmount   stake tokens amount
  */
  function stake(uint256 _stakeTokenAmount) public {
    stakeFor(_stakeTokenAmount, msg.sender);
  }

  /**
  * @dev lock stake tokens for a stake period
  *
  * @param _stakeTokenAmount   stake tokens amount
  * @param _receiver           stake shares receiver
  */
  function stakeFor(uint256 _stakeTokenAmount, address _receiver) public {
    // check time
    require(now < end, "Stake end");
    // calculate shares
    uint256 sharesToMint = calculateSharesToMint(_stakeTokenAmount);
    // not allow 0 shares
    require(sharesToMint > 0, "Empty shares");
    // check if need add bonus
    uint256 bonus = calculateRewardBonus(sharesToMint);
    if(bonus > 0){
      sharesToMint = sharesToMint.add(bonus);
      bonusSupply = bonusSupply.add(bonus);
    }

    // transfer pool token from sender to this contract
    stakeToken.transferFrom(msg.sender, address(this), _stakeTokenAmount);

    // update states for receiver
    stakesOf[_receiver] = stakesOf[_receiver].add(_stakeTokenAmount);
    balanceOf[_receiver] = balanceOf[_receiver].add(sharesToMint);

    // update totals
    totalSupply = totalSupply.add(sharesToMint);
    totalStaked = totalStaked.add(_stakeTokenAmount);

    // emit event
    emit Staked(_receiver, _stakeTokenAmount, totalSupply);
  }


  /**
  * @dev allow withdraw stake tokens + reward tokens, after finished stake program
  */
  function unstake() public {
    // check time
    require(now >= end, "Early");
    // check user shares
    require(balanceOf[msg.sender] > 0, "Nothing to unstake");

    // calculate user reward
    uint256 userReward = calculateRewardByShare(balanceOf[msg.sender]);

    // transfer reward token to user
    rewardToken.transfer(msg.sender, userReward);

    // transfer stake token to user
    uint256 unstakeAmount = stakesOf[msg.sender];
    stakeToken.transfer(msg.sender, unstakeAmount);

    // update states
    uint256 sharesToBurn = balanceOf[msg.sender];

    // reset user state
    stakesOf[msg.sender] = 0;
    balanceOf[msg.sender] = 0;

    // sub users share from total
    totalSupply = totalSupply.sub(sharesToBurn);
    totalStaked = totalStaked.sub(unstakeAmount);

    // emit event
    emit Unstaked(msg.sender, unstakeAmount, totalSupply);
  }

  /**
  * @dev allow withdraw in any time, but without reward
  */
  function emergencyWithdraw() public {
    // check if user have some stake tokens
    uint256 amount = stakesOf[msg.sender];
    require(amount > 0, "Nothing to withdraw");

    // transfer
    stakeToken.transfer(msg.sender, amount);

    // update states
    uint256 sharesToBurn = balanceOf[msg.sender];

    // reset user state
    balanceOf[msg.sender] = 0;
    stakesOf[msg.sender] = 0;

    // sub users share from total
    totalSupply = totalSupply.sub(sharesToBurn);
    totalStaked = totalStaked.sub(amount);

    // emit event
    emit EmergencyWithdraw(msg.sender, amount, totalSupply);
  }


  // VIEW Functions
  /**
  * @dev calculate and return shares amount to mint by pool token amount
  *
  * @param _stakeTokenAmount   stake tokens amount
  */
  function calculateSharesToMint(uint256 _stakeTokenAmount) public view returns (uint256){
    if(_stakeTokenAmount > 0){
      // init shares
      if (totalSupply == 0)
       return INITIAL_SHARES;
      // calculate shares
      return _stakeTokenAmount.mul(totalSupply.sub(bonusSupply)).div(stakeToken.balanceOf(address(this)));
    }
    else{
      return 0;
    }
  }

  /**
  * @dev calculate and return reward bonus % share by share input
  *
  * @param _sharesAmount   amount of stake shares
  */
  function calculateRewardBonus(uint256 _sharesAmount) public view returns (uint256){
    if(now >= end)
      return 0;

    // each new block reduce bonus
    uint256 currentX = totalX.sub(totalX.mul(block.timestamp.sub(start)).div(duration));
    return _sharesAmount.div(100).mul(currentX);
  }

  /**
  * @dev calculate and return reward tokens
  *
  * @param _sharesAmount   amount of stake shares
  */
  function calculateRewardByShare(uint256 _sharesAmount) public view returns(uint256){
    if(_sharesAmount > 0){
      return totalRewards().mul(_sharesAmount).div(totalSupply);
    }
    else{
      return 0;
    }
  }


  /**
  * @dev return total reward tokens available on this contract balance
  */
  function totalRewards() public view returns(uint256){
    return rewardToken.balanceOf(address(this));
  }
}
