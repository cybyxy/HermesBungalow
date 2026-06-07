import React, { FC } from 'react'
import '../index.css'
import { useCalculator } from '../hooks/useCalculator'

export interface ButtonGridProps {
  actions: ReturnType<typeof useCalculator>['actions']
  waitingForOperand: boolean
  lastOperator: string | null
}

export interface ButtonConfig {
  label: string
  type: 'number' | 'operator' | 'function' | 'equals'
  action: string
  value?: string
  span?: number
}

const BUTTONS: ButtonConfig[][] = [
  [
    { label: 'C', type: 'function', action: 'clear' },
    { label: '⌫', type: 'function', action: 'backspace' },
    { label: '%', type: 'function', action: 'percentage' },
    { label: '÷', type: 'operator', action: 'inputOperator', value: '÷' },
  ],
  [
    { label: '7', type: 'number', action: 'inputDigit', value: '7' },
    { label: '8', type: 'number', action: 'inputDigit', value: '8' },
    { label: '9', type: 'number', action: 'inputDigit', value: '9' },
    { label: '×', type: 'operator', action: 'inputOperator', value: '×' },
  ],
  [
    { label: '4', type: 'number', action: 'inputDigit', value: '4' },
    { label: '5', type: 'number', action: 'inputDigit', value: '5' },
    { label: '6', type: 'number', action: 'inputDigit', value: '6' },
    { label: '−', type: 'operator', action: 'inputOperator', value: '-' },
  ],
  [
    { label: '1', type: 'number', action: 'inputDigit', value: '1' },
    { label: '2', type: 'number', action: 'inputDigit', value: '2' },
    { label: '3', type: 'number', action: 'inputDigit', value: '3' },
    { label: '+', type: 'operator', action: 'inputOperator', value: '+' },
  ],
  [
    { label: '0', type: 'number', action: 'inputDigit', value: '0', span: 2 },
    { label: '.', type: 'number', action: 'inputDecimal' },
    { label: '=', type: 'equals', action: 'calculate' },
  ],
]

const ButtonGrid: FC<ButtonGridProps> = ({ actions, waitingForOperand, lastOperator }) => {
  const handleClick = (btn: ButtonConfig) => {
    switch (btn.action) {
      case 'inputDigit':
        if (btn.value) actions.inputDigit(btn.value)
        break
      case 'inputDecimal':
        actions.inputDecimal()
        break
      case 'inputOperator':
        if (btn.value) actions.inputOperator(btn.value)
        break
      case 'calculate':
        actions.calculate()
        break
      case 'clear':
        actions.clear()
        break
      case 'backspace':
        actions.backspace()
        break
      case 'percentage':
        actions.percentage()
        break
      case 'toggleSign':
        actions.toggleSign()
        break
    }
  }

  return (
    <div className="button-grid" role="group" aria-label="Calculator buttons">
      {BUTTONS.flat().map((btn, idx) => {
        const isActive = btn.type === 'operator'
          && lastOperator === btn.value
          && waitingForOperand

        return (
          <button
            key={idx}
            className={`btn ${btn.type}${isActive ? ' operator active' : ''}`}
            style={btn.span ? { gridColumn: `span ${btn.span}` } : undefined}
            onClick={() => handleClick(btn)}
            aria-label={btn.label}
          >
            {btn.label}
          </button>
        )
      })}
    </div>
  )
}

export default ButtonGrid
