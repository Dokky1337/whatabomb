export interface RoundState {
  currentRound: number
  maxRounds: number
  playerWins: number
  enemyWins: number
}

export interface TimeAttackState {
  timeRemaining: number
  maxTime: number
  enemiesDefeated: number
  bonusTimePerKill: number
}

export class GameStateManager {
  private roundState: RoundState | null = null
  private timeAttackState: TimeAttackState | null = null

  // Round System
  initRounds(maxRounds: number = 3) {
    this.roundState = {
      currentRound: 1,
      maxRounds,
      playerWins: 0,
      enemyWins: 0,
    }
  }

  getRoundState(): RoundState | null {
    return this.roundState
  }

  recordPlayerRoundWin() {
    if (!this.roundState) return
    this.roundState.playerWins++
  }

  recordEnemyRoundWin() {
    if (!this.roundState) return
    this.roundState.enemyWins++
  }

  nextRound() {
    if (!this.roundState) return
    this.roundState.currentRound++
  }

  isMatchOver(): boolean {
    if (!this.roundState) return false
    const winsNeeded = Math.ceil(this.roundState.maxRounds / 2)
    return (
      this.roundState.playerWins >= winsNeeded ||
      this.roundState.enemyWins >= winsNeeded
    )
  }

  getMatchWinner(): 'player' | 'enemy' | null {
    if (!this.roundState || !this.isMatchOver()) return null
    return this.roundState.playerWins > this.roundState.enemyWins ? 'player' : 'enemy'
  }

  // Time Attack
  initTimeAttack(maxTime: number = 180000, bonusTimePerKill: number = 5000) {
    this.timeAttackState = {
      timeRemaining: maxTime,
      maxTime,
      enemiesDefeated: 0,
      bonusTimePerKill,
    }
  }

  getTimeAttackState(): TimeAttackState | null {
    return this.timeAttackState
  }

  updateTimeAttack(deltaTime: number) {
    if (!this.timeAttackState) return
    this.timeAttackState.timeRemaining -= deltaTime
  }

  addBonusTime() {
    if (!this.timeAttackState) return
    this.timeAttackState.timeRemaining += this.timeAttackState.bonusTimePerKill
    this.timeAttackState.enemiesDefeated++
  }

  isTimeUp(): boolean {
    if (!this.timeAttackState) return false
    return this.timeAttackState.timeRemaining <= 0
  }

  getTimeString(): string {
    if (!this.timeAttackState) return '0:00'
    const seconds = Math.max(0, Math.floor(this.timeAttackState.timeRemaining / 1000))
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  reset() {
    this.roundState = null
    this.timeAttackState = null
  }
}
