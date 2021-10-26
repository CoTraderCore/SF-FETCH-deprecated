import { BN, fromWei, toWei } from 'web3-utils'
import ether from './helpers/ether'
import EVMRevert from './helpers/EVMRevert'
import { duration } from './helpers/duration'
import { PairHash } from '../config'


const BigNumber = BN
const timeMachine = require('ganache-time-traveler')

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

const ETH_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// real contracts
const UniswapV2Factory = artifacts.require('./UniswapV2Factory.sol')
const UniswapV2Router = artifacts.require('./UniswapV2Router02.sol')
const UniswapV2Pair = artifacts.require('./UniswapV2Pair.sol')
const WETH = artifacts.require('./WETH9.sol')
const TOKEN = artifacts.require('./TOKEN.sol')
const Stake = artifacts.require('./Stake.sol')

const stakeDuration = duration.years(5)
const totalX = 400

let uniswapV2Factory,
    uniswapV2Router,
    weth,
    token,
    pair,
    pairAddress,
    stake


contract('Stake-test', function([userOne, userTwo, userThree]) {

  async function deployContracts(){
    // deploy contracts
    uniswapV2Factory = await UniswapV2Factory.new(userOne)
    weth = await WETH.new()
    uniswapV2Router = await UniswapV2Router.new(uniswapV2Factory.address, weth.address)
    token = await TOKEN.new(uniswapV2Router.address)

    // add token liquidity
    await token.approve(uniswapV2Router.address, toWei(String(500)))

    await uniswapV2Router.addLiquidityETH(
      token.address,
      toWei(String(500)),
      1,
      1,
      userOne,
      "1111111111111111111111"
    , { from:userOne, value:toWei(String(500)) })

    pairAddress = await uniswapV2Factory.allPairs(0)
    pair = await UniswapV2Pair.at(pairAddress)

    stake = await Stake.new(
      pair.address,
      token.address,
      stakeDuration,
      totalX
    )

    // exclude stake from fee and balance validation
    await token.excludeFromFee(stake.address)
    await token.excludeFromTransferLimit(stake.address)

    // add rewards to claim stake
    token.transfer(stake.address, await token.balanceOf(userOne))
  }

  beforeEach(async function() {
    await deployContracts()
  })

  describe('INIT stake', function() {
    it('Correct init Stake', async function() {
      assert.equal(await stake.rewardToken(), token.address)
      assert.equal(await stake.stakeToken(), pair.address)
    })
  })

  describe('STAKE', function() {
    it('User can stake and emergency withdarw (shares burned)', async function() {
      // check balances before stake
      const userPoolBalanceBefore = Number(await pair.balanceOf(userOne))
      assert.equal(await pair.balanceOf(stake.address), 0)

      // stake
      await pair.approve(stake.address, toWei("1"))
      await stake.stake(toWei("1"))

      // user get shares
      assert.notEqual(await stake.balanceOf(userOne), 0)
      assert.notEqual(await stake.totalSupply(), 0)

      // stake get pool token
      assert.equal(await pair.balanceOf(stake.address), toWei("1"))
      // user send pool token
      assert.notEqual(userPoolBalanceBefore, Number(await pair.balanceOf(userOne)))

      // emergency withdraw
      await stake.emergencyWithdraw()

      // shares burned
      assert.equal(await stake.balanceOf(userOne), 0)
      assert.equal(await stake.totalSupply(), 0)

      // stake send pool token
      assert.equal(await pair.balanceOf(stake.address), 0)
      // user get back pool token
      assert.equal(userPoolBalanceBefore, Number(await pair.balanceOf(userOne)))
    })

    it('User can not unstake ahead of time', async function() {
      // check balances before stake
      const userPoolBalanceBefore = Number(await pair.balanceOf(userOne))
      assert.equal(await pair.balanceOf(stake.address), 0)

      // stake
      await pair.approve(stake.address, toWei("1"))
      await stake.stake(toWei("1"))

      // stake get pool token
      assert.equal(await pair.balanceOf(stake.address), toWei("1"))
      // user send pool token
      assert.notEqual(userPoolBalanceBefore, Number(await pair.balanceOf(userOne)))

      // unstake
      await stake.unstake().should.be.rejectedWith(EVMRevert)
    })

    it('User can unstake after finish stake program and get rewards (shares burned)', async function() {
      // check balances before stake
      const userTokenBalanceBefore = Number(await token.balanceOf(userOne))
      const userPoolBalanceBefore = Number(await pair.balanceOf(userOne))
      assert.equal(await pair.balanceOf(stake.address), 0)

      // stake
      await pair.approve(stake.address, toWei("1"))
      await stake.stake(toWei("1"))

      // user get shares
      assert.notEqual(await stake.balanceOf(userOne), 0)
      assert.notEqual(await stake.totalSupply(), 0)

      // stake get pool token
      assert.equal(await pair.balanceOf(stake.address), toWei("1"))
      // user send pool token
      assert.notEqual(userPoolBalanceBefore, Number(await pair.balanceOf(userOne)))

      await timeMachine.advanceTimeAndBlock(stakeDuration)

      // unstake
      await stake.unstake()

      // shares burned
      assert.equal(await stake.balanceOf(userOne), 0)
      assert.equal(await stake.totalSupply(), 0)

      // stake send pool token
      assert.equal(await pair.balanceOf(stake.address), 0)
      // user get back pool token
      assert.equal(userPoolBalanceBefore, Number(await pair.balanceOf(userOne)))

      // stake send all rewards to user beacuse this user have 100% shares
      assert.equal(await token.balanceOf(stake.address), 0)
      assert.isTrue(
        Number(await token.balanceOf(userOne)) > userTokenBalanceBefore
      )
    })

    it('User who join 2x latter get 2x less', async function() {
      // check balances before stake
      assert.equal(await pair.balanceOf(stake.address), 0)

      // stake from user 1
      await pair.approve(stake.address, toWei("1"))
      await stake.stake(toWei("1"))

      // send pool token to user 2
      await pair.transfer(userTwo, toWei("1"))

      // stake from user 2
      await timeMachine.advanceTimeAndBlock(stakeDuration / 2)
      await pair.approve(stake.address, toWei("1"), { from:userTwo })
      await stake.stake(toWei("1"), { from:userTwo })

      // stake get pool tokens
      assert.equal(await pair.balanceOf(stake.address), toWei("2"))

      await timeMachine.advanceTimeAndBlock(stakeDuration)

      // unstake
      await stake.unstake()
      await stake.unstake({ from:userTwo })

      // stake send all pool tokens
      assert.equal(await pair.balanceOf(stake.address), 0)
      // stake send all rewards
      assert.equal(await token.balanceOf(stake.address), 0)

      console.log(
        `User 1 rewards - ${fromWei(await token.balanceOf(userOne))} User 2 rewards ${fromWei(await token.balanceOf(userTwo))}`
      )
      assert.isTrue(
        fromWei(await token.balanceOf(userOne)) > fromWei(await token.balanceOf(userTwo))
      )
    })
  })

  describe('Calculate reward bonus', function() {
    it('logs', async function() {
      const partDurtaion = stakeDuration / 10
      console.log(`Input 1, x = ${totalX}`)
      for(let i = 0; i < 11; i++){
        console.log(`Bonus ${fromWei(await stake.calculateRewardBonus(toWei("1")))}`)
        await timeMachine.advanceTimeAndBlock(partDurtaion)
      }
    })
  })

  //END
})
