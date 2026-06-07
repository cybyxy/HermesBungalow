import { CSSProperties, FC } from 'react'

export interface DisplayProps {
  currentValue: string
  expression: string
  history: string[]
  error: string | null
}

const Display: FC<DisplayProps> = ({ currentValue, expression, history, error }) => {
  const fontSize = currentValue.length > 12 ? 28 : currentValue.length > 8 ? 36 : 48

  const displayHistory = history.length > 0
    ? history[history.length - 1].split(' = ')[0] || ''
    : expression

  return (
    <div className="display">
      <div className="display-history">
        {displayHistory || '\u00A0'}
      </div>
      <div
        className={`display-current ${error ? 'error' : ''}`}
        style={{ fontSize: `${fontSize}px` }}
        aria-live="polite"
        role="status"
      >
        {error || currentValue}
      </div>
    </div>
  )
}

export default Display
