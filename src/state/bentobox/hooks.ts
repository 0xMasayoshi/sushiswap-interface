import { JSBI, Token, WNATIVE, CurrencyAmount, Currency } from '@sushiswap/sdk'
import { useBentoBoxContract, useBoringHelperContract, useContract } from '../../hooks/useContract'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import ERC20_ABI from '../../constants/abis/erc20.json'
import { KASHI_ADDRESS } from '../../constants/kashi'
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

export interface BentoBalance {
  token: any
  wallet: CurrencyAmount<Currency>
  bento: CurrencyAmount<Currency>
}

export function useBentoBalances(): BentoBalance[] {
  const { chainId, account } = useActiveWeb3React()

  const bentoBoxContract = useBentoBoxContract()

  const tokens = useAllTokens()

  const weth = WNATIVE[chainId].address

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

  return useMemo(() => {
    for (let i = 0; i < tokenAddresses.length; ++i) {
      if (
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

    const ethBalance = BigNumber.from(ethBalances[account].quotient.toString())

    return tokenAddresses
      .map((key: string, i: number) => {
        const token = tokens[key]
        const { result: balance } = balances[i]
        const { result: bentoBalance } = bentoBalances[i]
        const { result: bentoTotal } = bentoTotals[i]

        // const wallet = token.address === weth.address ? ethBalance.add(balance[0]) : balance[0]
        const wallet = balance[0]
        const bento = toAmount({ bentoAmount: bentoTotal[0], bentoShare: bentoTotal[1] }, bentoBalance[0])

        return {
          token,
          wallet: CurrencyAmount.fromRawAmount(token, JSBI.BigInt(wallet)),
          bento: CurrencyAmount.fromRawAmount(token, JSBI.BigInt(bento)),
        }
      })
      .filter((token) => token.wallet.greaterThan('0') || token.bento.greaterThan('0'))
  }, [ethBalances, account, tokenAddresses, balances, bentoBalances, bentoTotals, tokens])
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
