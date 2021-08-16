import { JSBI, Currency, WNATIVE } from '@sushiswap/sdk'
import { useBentoBoxContract, useBoringHelperContract, useContract } from '../../hooks/useContract'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import ERC20_ABI from '../../constants/abis/erc20.json'
import { KASHI_ADDRESS } from '../../constants/kashi'
import { USDC } from '../../hooks'
import { WrappedTokenInfo } from '../lists/wrappedTokenInfo'
import { Zero } from '@ethersproject/constants'
import { e10 } from '../../functions/math'
import { easyAmount } from '../../functions/kashi'
import { getAddress } from '@ethersproject/address'
import { toAmount } from '../../functions/bentobox'
import { useActiveWeb3React } from '../../hooks/useActiveWeb3React'
import { useAllTokens } from '../../hooks/Tokens'
import { useMultipleContractSingleData, useSingleCallResult, useSingleContractMultipleData } from '../multicall/hooks'
import useTransactionStatus from '../../hooks/useTransactionStatus'
import ERC20_INTERFACE from '../../constants/abis/erc20'
import { useETHBalances } from '../wallet/hooks'
import { PairState, useV2Pairs } from '../../hooks/useV2Pairs'

export interface BentoBalance {
  address: string
  name: string
  symbol: string
  decimals: number
  balance: any
  bentoBalance: any
  wallet: any
  bento: any
}

export function useBentoBalances(): BentoBalance[] {
  const { chainId, account } = useActiveWeb3React()

  const bentoBoxContract = useBentoBoxContract()

  const tokens = useAllTokens()

  const weth = WNATIVE[chainId]

  const tokenAddresses = Object.keys(tokens)

  const ethBalances = useETHBalances([account])

  const balances = useMultipleContractSingleData(tokenAddresses, ERC20_INTERFACE, 'balanceOf', [account])

  const bentoBalances = useSingleContractMultipleData(
    bentoBoxContract,
    'balanceOf',
    tokenAddresses.map((token) => [token, account])
  )

  const bentoTotals = useSingleContractMultipleData(
    bentoBoxContract,
    'totals',
    tokenAddresses.map((token) => [token])
  )

  const currencies: [Currency, Currency][] = useMemo(
    () => tokenAddresses.map((tokenAddress) => [tokens[tokenAddress], weth]),
    [tokens, tokenAddresses, weth]
  )

  const pairs = useV2Pairs(currencies)

  const rates: BigNumber[] = useMemo(
    () =>
      tokenAddresses.map((tokenAddress, i) => {
        const [pairState, pair] = pairs[i]
        if (tokenAddress === weth.address) {
          return BigNumber.from((1e18).toString())
        } else if (pairState !== PairState.EXISTS) {
          return BigNumber.from('0')
        } else {
          if (pair.token0.address === weth.address) {
            return BigNumber.from(
              pair.reserve1.multiply(JSBI.BigInt((1e18).toString())).divide(pair.reserve0).quotient.toString()
            )
          } else {
            return BigNumber.from(
              pair.reserve0.multiply(JSBI.BigInt((1e18).toString())).divide(pair.reserve1).quotient.toString()
            )
          }
        }
      }),
    [tokenAddresses, pairs, weth.address]
  )

  return useMemo(() => {
    for (let i = 0; i < tokenAddresses.length; ++i) {
      if (
        !rates ||
        balances[i].loading ||
        balances[i].error ||
        !balances[i].result ||
        bentoBalances[i].loading ||
        bentoBalances[i].error ||
        !bentoBalances[i].result ||
        bentoTotals[i].loading ||
        bentoTotals[i].error ||
        !bentoTotals[i].result
      ) {
        return []
      }
    }

    const usdcRate = rates[tokenAddresses.indexOf(USDC[chainId].address)]
    const ethBalance = BigNumber.from(ethBalances[account].quotient.toString())

    return tokenAddresses
      .map((key: string, i: number) => {
        const token = tokens[key]
        const { result: balance } = balances[i]
        const { result: bentoBalance } = bentoBalances[i]
        const { result: bentoTotal } = bentoTotals[i]

        const usd = e10(token.decimals).mulDiv(usdcRate, rates[i])

        const full = {
          ...token,
          bentoAmount: bentoTotal[0],
          bentoShare: bentoTotal[1],
          usd,
        }

        return {
          ...token,
          usd,
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: token.address === weth.address ? ethBalance.add(balance[0]) : balance[0],
          bentoBalance: bentoBalance[0],
          wallet: easyAmount(token.address === weth.address ? ethBalance.add(balance[0]) : balance[0], full),
          bento: easyAmount(toAmount(full, bentoBalance[0]), full),
        }
      })
      .filter((token) => token.balance.gt('0') || token.bentoBalance.gt('0'))
  }, [tokens, tokenAddresses, rates, balances, bentoBalances, bentoTotals, weth.address, ethBalances, account, chainId])
}

export function useBentoBalance(tokenAddress: string): {
  value: BigNumber
  decimals: number
} {
  const { account } = useActiveWeb3React()

  const boringHelperContract = useBoringHelperContract()
  const bentoBoxContract = useBentoBoxContract()
  const tokenAddressChecksum = getAddress(tokenAddress)
  const tokenContract = useContract(tokenAddressChecksum ? tokenAddressChecksum : undefined, ERC20_ABI)

  const currentTransactionStatus = useTransactionStatus()

  const [balance, setBalance] = useState<any>()

  // const balanceData = useSingleCallResult(boringHelperContract, 'getBalances', [account, tokenAddresses])

  const fetchBentoBalance = useCallback(async () => {
    const balances = await boringHelperContract?.getBalances(account, [tokenAddressChecksum])
    const decimals = await tokenContract?.decimals()

    const amount = BigNumber.from(balances[0].bentoShare).isZero()
      ? BigNumber.from(0)
      : BigNumber.from(balances[0].bentoBalance)
          .mul(BigNumber.from(balances[0].bentoAmount))
          .div(BigNumber.from(balances[0].bentoShare))

    setBalance({
      value: amount,
      decimals: decimals,
    })
  }, [account, tokenAddressChecksum, tokenContract, boringHelperContract])

  useEffect(() => {
    if (account && bentoBoxContract && boringHelperContract && tokenContract) {
      fetchBentoBalance()
    }
  }, [account, bentoBoxContract, currentTransactionStatus, fetchBentoBalance, tokenContract, boringHelperContract])

  return balance
}

export function useBentoMasterContractAllowed(masterContract?: string, user?: string): boolean | undefined {
  const contract = useBentoBoxContract()

  const inputs = useMemo(() => [masterContract, user], [masterContract, user])

  const allowed = useSingleCallResult(contract, 'masterContractApproved', inputs).result

  return useMemo(() => (allowed ? allowed[0] : undefined), [allowed])
}
