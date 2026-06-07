import Display from './components/Display'
import ButtonGrid from './components/ButtonGrid'
import { useCalculator } from './hooks/useCalculator'
import './index.css'

function App() {
  const { state, actions } = useCalculator()

  return (
    <div className="calculator">
      <div className="calc-body">
        <Display
          currentValue={state.currentValue}
          expression={state.expression}
          history={state.history}
          error={state.error}
        />
        <ButtonGrid actions={actions} waitingForOperand={state.waitingForOperand} lastOperator={state.lastOperator} />
      </div>
    </div>
  )
}

export default App
