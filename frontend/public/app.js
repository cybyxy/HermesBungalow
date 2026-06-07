/**
 * Hermes Calculator — JavaScript Logic
 * 支持：加减乘除、百分比、正负号切换、历史记录
 */

class Calculator {
  constructor() {
    this.currentInput = '0';
    this.previousInput = '';
    this.operator = null;
    this.shouldResetScreen = false;
    this.history = [];
    
    // DOM elements
    this.resultBar = document.getElementById('resultBar');
    this.expressionBar = document.getElementById('expressionBar');
    this.historyList = document.getElementById('historyList');
    this.historyEmpty = document.getElementById('historyEmpty');
    this.clickSound = document.getElementById('clickSound');
    
    this.init();
  }
  
  init() {
    // 按钮事件委托
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleButtonClick(e));
    });
    
    // 键盘支持
    document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    
    // 历史记录清除
    document.getElementById('clearHistory').addEventListener('click', () => {
      this.clearHistory();
    });
    
    // 历史切换
    document.getElementById('historyToggle').addEventListener('click', () => {
      this.toggleHistory();
    });
    
    // 加载历史记录
    this.loadHistory();
    this.updateDisplay();
  }
  
  handleButtonClick(e) {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const value = btn.dataset.value;
    
    // 播放点击音效
    this.playClickSound();
    
    // 移除错误状态
    this.resultBar.classList.remove('error-shake');
    
    switch (action) {
      case 'digit':
        this.inputDigit(value);
        break;
      case 'operator':
        this.inputOperator(value);
        break;
      case 'equals':
        this.calculate();
        break;
      case 'clear':
        this.clear();
        break;
      case 'toggle-sign':
        this.toggleSign();
        break;
      case 'percent':
        this.percent();
        break;
      case 'decimal':
        this.inputDecimal();
        break;
    }
  }
  
  handleKeyPress(e) {
    const key = e.key;
    
    if (key >= '0' && key <= '9') {
      this.inputDigit(key);
      this.playClickSound();
    } else if (key === '.') {
      this.inputDecimal();
      this.playClickSound();
    } else if (key === '+') {
      this.inputOperator('+');
      this.playClickSound();
    } else if (key === '-') {
      this.inputOperator('−');
      this.playClickSound();
    } else if (key === '*') {
      this.inputOperator('×');
      this.playClickSound();
    } else if (key === '/') {
      e.preventDefault();
      this.inputOperator('÷');
      this.playClickSound();
    } else if (key === 'Enter' || key === '=') {
      e.preventDefault();
      this.calculate();
      this.playClickSound();
    } else if (key === 'Escape' || key === 'c' || key === 'C') {
      this.clear();
      this.playClickSound();
    } else if (key === '%') {
      this.percent();
      this.playClickSound();
    }
  }
  
  inputDigit(digit) {
    if (this.shouldResetScreen) {
      this.currentInput = digit;
      this.shouldResetScreen = false;
    } else {
      this.currentInput = this.currentInput === '0' ? digit : this.currentInput + digit;
    }
    this.updateDisplay();
  }
  
  inputDecimal() {
    if (this.shouldResetScreen) {
      this.currentInput = '0.';
      this.shouldResetScreen = false;
      this.updateDisplay();
      return;
    }
    
    if (!this.currentInput.includes('.')) {
      this.currentInput += '.';
    }
    this.updateDisplay();
  }
  
  inputOperator(op) {
    if (this.operator && !this.shouldResetScreen) {
      this.calculate();
    }
    
    this.previousInput = this.currentInput;
    this.operator = op;
    this.shouldResetScreen = true;
    this.updateDisplay();
  }
  
  calculate() {
    if (!this.operator || !this.previousInput) return;
    
    const prev = parseFloat(this.previousInput);
    const current = parseFloat(this.currentInput);
    let result;
    
    const expression = `${this.formatNumber(prev)} ${this.operator} ${this.formatNumber(current)} =`;
    
    switch (this.operator) {
      case '+':
        result = prev + current;
        break;
      case '−':
        result = prev - current;
        break;
      case '×':
        result = prev * current;
        break;
      case '÷':
        if (current === 0) {
          this.showError('不能除以零');
          return;
        }
        result = prev / current;
        break;
      default:
        return;
    }
    
    // 处理浮点精度
    result = this.fixPrecision(result);
    
    // 添加到历史记录
    this.addToHistory(expression, this.formatNumber(result));
    
    this.currentInput = result.toString();
    this.operator = null;
    this.previousInput = '';
    this.shouldResetScreen = true;
    
    this.updateDisplay();
  }
  
  percent() {
    const current = parseFloat(this.currentInput);
    this.currentInput = this.fixPrecision(current / 100).toString();
    this.updateDisplay();
  }
  
  toggleSign() {
    const current = parseFloat(this.currentInput);
    if (current !== 0) {
      this.currentInput = this.fixPrecision(-current).toString();
      this.updateDisplay();
    }
  }
  
  clear() {
    this.currentInput = '0';
    this.previousInput = '';
    this.operator = null;
    this.shouldResetScreen = false;
    this.updateDisplay();
  }
  
  fixPrecision(num) {
    return Math.round(num * 1e12) / 1e12;
  }
  
  formatNumber(num) {
    if (typeof num === 'string') {
      // 已经是字符串形式
      return num;
    }
    
    const str = num.toString();
    
    // 科学计数法
    if (Math.abs(num) >= 1e12 || (Math.abs(num) < 1e-8 && num !== 0)) {
      return num.toExponential(6);
    }
    
    // 处理小数位数
    if (str.includes('.')) {
      const parts = str.split('.');
      const decimals = parts[1].length;
      if (decimals > 10) {
        return num.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
      }
    }
    
    return str;
  }
  
  updateDisplay() {
    // 更新结果
    this.resultBar.textContent = this.formatNumber(this.currentInput);
    
    // 更新表达式
    if (this.operator && this.previousInput) {
      this.expressionBar.textContent = `${this.formatNumber(this.previousInput)} ${this.operator}`;
    } else {
      this.expressionBar.textContent = '';
    }
    
    // 动态调整字体大小
    const inputLength = this.resultBar.textContent.length;
    if (inputLength > 12) {
      this.resultBar.classList.add('small-text');
    } else {
      this.resultBar.classList.remove('small-text');
    }
  }
  
  showError(message) {
    this.resultBar.textContent = message;
    this.resultBar.classList.add('error-shake');
    
    setTimeout(() => {
      this.clear();
    }, 1500);
  }
  
  playClickSound() {
    try {
      this.clickSound.currentTime = 0;
      this.clickSound.play().catch(() => {});
    } catch (e) {
      // 静默失败
    }
  }
  
  // --- 历史记录 ---
  
  addToHistory(expression, result) {
    this.history.unshift({
      expression: expression,
      result: result,
      timestamp: Date.now()
    });
    
    // 限制历史记录数量
    if (this.history.length > 20) {
      this.history.pop();
    }
    
    this.saveHistory();
    this.renderHistory();
  }
  
  renderHistory() {
    if (this.history.length === 0) {
      this.historyEmpty.style.display = 'block';
      this.historyList.innerHTML = '';
      return;
    }
    
    this.historyEmpty.style.display = 'none';
    
    this.historyList.innerHTML = this.history.map((item, index) => `
      <li class="history-item" data-index="${index}">
        <div style="font-size: 12px; opacity: 0.6; margin-bottom: 2px;">${item.expression}</div>
        <div style="font-size: 16px; font-weight: 500;">${item.result}</div>
      </li>
    `).join('');
    
    // 添加点击事件
    document.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        this.loadFromHistory(index);
      });
    });
  }
  
  loadFromHistory(index) {
    const item = this.history[index];
    if (item) {
      this.currentInput = item.result;
      this.shouldResetScreen = true;
      this.updateDisplay();
    }
  }
  
  saveHistory() {
    try {
      localStorage.setItem('calculator_history', JSON.stringify(this.history));
    } catch (e) {
      // 静默失败
    }
  }
  
  loadHistory() {
    try {
      const saved = localStorage.getItem('calculator_history');
      if (saved) {
        this.history = JSON.parse(saved);
        this.renderHistory();
      }
    } catch (e) {
      this.history = [];
    }
  }
  
  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.renderHistory();
  }
  
  toggleHistory() {
    const panel = document.querySelector('.history-panel');
    panel.classList.toggle('hidden');
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.calculator = new Calculator();
});
