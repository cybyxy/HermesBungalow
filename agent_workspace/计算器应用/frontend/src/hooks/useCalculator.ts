import { useState, useCallback, useEffect } from 'react'
import Big from 'big.js'

export interface CalcState {
  currentValue: string
  expression: string
  history: string[]
  error: string | null
  waitingForOperand: boolean
  lastOperator: string | null
}

export type CalcAction =
  | { type: 'INPUT_DIGIT'; digit: string }
  | { type: 'INPUT_DECIMAL' }
  | { type: 'INPUT_OPERATOR'; operator: string }
  | { type: 'CALCULATE' }
  | { type: 'CLEAR' }
  | { type: 'TOGGLE_SIGN' }
  | { type: 'PERCENTAGE' }
  | { type: 'BACKSPACE' }

const INITIAL_STATE: CalcState = {
  currentValue: '0',
  expression: '',
  history: [],
  error: null,
  waitingForOperand: false,
  lastOperator: null,
}

function evaluateExpression(expr: string): { value?: string; error?: string } {
  try {
    // Tokenize and parse using recursive descent
    const tokens = tokenize(expr)
    if (tokens.length === 0) return { error: '空表达式' }

    let pos = 0
    const peek = () => tokens[pos]
    const consume = () => tokens[pos++]

    function parseExpr(): string {
      let left = parseTerm()
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume()
        const right = parseTerm()
        left = op.value === '+' ? Big(left).plus(right).toString() : Big(left).minus(right).toString()
      }
      return left
    }

    function parseTerm(): string {
      let left = parseFactor()
      while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
        const op = consume()
        const right = parseFactor()
        if (op.value === '*') {
          left = Big(left).times(right).toString()
        } else {
          const res = Big(left).div(right)
          if (res.error) return 'Error'
          left = res.toString()
        }
      }
      return left
    }

    function parseFactor(): string {
      if (!peek()) throw new Error('Unexpected end')
      if (peek().type !== 'num') throw new Error('Expected number')
      return consume().value
    }

    const result = parseExpr()
    return { value: result }
  } catch (e: any) {
    return { error: e.message || '表达式错误' }
  }
}

function tokenize(expr: string): Array<{ type: 'num' | 'op'; value: string }> {
  const tokens: Array<{ type: 'num' | 'op'; value: string }> = []
  let i = 0
  const s = expr.replace(/\s+/g, '')

  while (i < s.length) {
    const ch = s[i]
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < s.length && /[0-9.]/.test(s[i])) {
        num += s[i]
        i++
      }
      if (!Big(num)) return []
      tokens.push({ type: 'num', value: num })
    } else if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
    } else {
      return []
    }
  }
  return tokens
}

function formatBig(val: string): string {
  // Clean up: remove trailing zeros after decimal, cap length
  const b = Big(val)
  const str = b.toString()
  if (str.length > 18) {
    return b.toExponential(6)
  }
  return str
}

function reducer(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case 'INPUT_DIGIT': {
      if (state.error) return { ...INITIAL_STATE, currentValue: action.digit }
      if (state.waitingForOperand) return { ...state, currentValue: action.digit, waitingForOperand: false, error: null }
      if (state.currentValue === '0') return { ...state, currentValue: action.digit }
      if (state.currentValue.replace(/[^0-9]/g, '').length >= 16) return state
      return { ...state, currentValue: state.currentValue + action.digit }
    }
    case 'INPUT_DECIMAL': {
      if (state.error) return { ...INITIAL_STATE, currentValue: '0.' }
      if (state.waitingForOperand) return { ...state, currentValue: '0.', waitingForOperand: false, error: null }
      if (state.currentValue.includes('.')) return state
      return { ...state, currentValue: state.currentValue + '.' }
    }
    case 'INPUT_OPERATOR': {
      if (state.error) return state
      const current = Big(state.currentValue)

      if (state.waitingForOperand && state.lastOperator) {
        // Swap operator
        const expr = state.expression.slice(0, -state.lastOperator.length - 1)
        return { ...state, expression: `${expr} ${action.operator} `, lastOperator: action.operator }
      }

      if (!state.expression || state.expression.endsWith('=')) {
        return {
          ...state,
          expression: `${state.currentValue} ${action.operator} `,
          lastOperator: action.operator,
          waitingForOperand: true,
        }
      }

      // Evaluate pending expression first
      const fullExpr = state.expression + state.currentValue
      const result = evaluateExpression(fullExpr)
      if (result.error) return { ...INITIAL_STATE, error: result.error }
      const resultStr = formatBig(result.value!)

      return {
        currentValue: resultStr,
        expression: `${resultStr} ${action.operator} `,
        history: [...state.history, `${fullExpr} = ${resultStr}`],
        lastOperator: action.operator,
        waitingForOperand: true,
        error: null,
      }
    }
    case 'CALCULATE': {
      if (state.error) return state
      if (!state.expression) {
        return { ...state, history: [...state.history, `${state.currentValue} = ${state.currentValue}`] }
      }
      const fullExpr = state.expression + state.currentValue
      const result = evaluateExpression(fullExpr)
      if (result.error) return { ...INITIAL_STATE, error: result.error }
      const resultStr = formatBig(result.value!)
      return {
        currentValue: resultStr,
        expression: '',
        history: [...state.history, `${fullExpr} = ${resultStr}`],
        lastOperator: null,
        waitingForOperand: true,
        error: null,
      }
    }
    case 'CLEAR':
      return INITIAL_STATE
    case 'TOGGLE_SIGN': {
      if (state.error || state.currentValue === '0') return state
      return { ...state, currentValue: state.currentValue.startsWith('-') ? state.currentValue.slice(1) : '-' + state.currentValue }
    }
    case 'PERCENTAGE': {
      if (state.error) return state
      const result = Big(state.currentValue).div(100)
      return { ...state, currentValue: result.toString() }
    }
    case 'BACKSPACE': {
      if (state.error || state.waitingForOperand) return state
      const next = state.currentValue.length > 1 ? state.currentValue.slice(0, -1) : '0'
      return { ...state, currentValue: next }
    }
    default:
      return state
  }
}

export function useCalculator() {
  const [state, dispatch] = useState<CalcState>(INITIAL_STATE)

  const inputDigit = useCallback((digit: string) => { dispatch({ type: 'INPUT_DIGIT', digit }) }, [])
  const inputDecimal = useCallback(() => { dispatch({ type: 'INPUT_DECIMAL' }) }, [])
  const inputOperator = useCallback((operator: string) => { dispatch({ type: 'INPUT_OPERATOR', operator }) }, [])
  const calculate = useCallback(() => { dispatch({ type: 'CALCULATE' }) }, [])
  const clear = useCallback(() => { dispatch({ type: 'CLEAR' }) }, [])
  const toggleSign = useCallback(() => { dispatch({ type: 'TOGGLE_SIGN' }) }, [])
  const percentage = useCallback(() => { dispatch({ type: 'PERCENTAGE' }) }, [])
  const backspace = useCallback(() => { dispatch({ type: 'BACKSPACE' }) }, [])

  // Keyboard mapping
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key
      if (/^[0-9]$/.test(key)) { e.preventDefault(); inputDigit(key) }
      else if (key === '.') { e.preventDefault(); inputDecimal() }
      else if (key === '+') { e.preventDefault(); inputOperator('+') }
      else if (key === '-') { e.preventDefault(); inputOperator('-') }
      else if (key === '*') { e.preventDefault(); inputOperator('×') }
      else if (key === '/') { e.preventDefault(); inputOperator('÷') }
      else if (key === 'Enter' || key === '=') { e.preventDefault(); calculate() }
      else if (key === 'Backspace') { e.preventDefault(); backspace() }
      else if (key === 'Escape' || key === 'Delete') { e.preventDefault(); clear() }
      else if (key === '%') { e.preventDefault(); percentage() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inputDigit, inputDecimal, inputOperator, calculate, clear, backspace, percentage])

  return {
    state: {
      currentValue: state.currentValue,
      expression: state.expression,
      history: state.history,
      error: state.error,
      waitingForOperand: state.waitingForOperand,
      lastOperator: state.lastOperator,
    },
    actions: { inputDigit, inputDecimal, inputOperator, calculate, clear, toggleSign, percentage, backspace },
  }
}
