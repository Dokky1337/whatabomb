import { SettingsManager, PLAYER_COLORS, CHARACTER_SHAPES } from './settings'
import { SoundManager } from './sound-manager'

export function createSettingsMenu(
  settingsManager: SettingsManager,
  soundManager: SoundManager | null,
  onClose: () => void
): HTMLDivElement {
  const settingsDiv = document.createElement('div')
  settingsDiv.id = 'settings-menu'
  settingsDiv.className = 'menu-container'
  settingsDiv.style.position = 'absolute'
  settingsDiv.style.top = '0'
  settingsDiv.style.left = '0'
  settingsDiv.style.width = '100vw'
  settingsDiv.style.height = '100vh'
  settingsDiv.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
  settingsDiv.style.display = 'none'
  settingsDiv.style.flexDirection = 'column'
  settingsDiv.style.justifyContent = 'center'
  settingsDiv.style.alignItems = 'center'
  settingsDiv.style.zIndex = '2500'
  settingsDiv.style.fontFamily = "'Russo One', sans-serif"
  settingsDiv.style.color = 'white'
  settingsDiv.style.overflowY = 'auto'
  settingsDiv.style.padding = '20px'

  const title = document.createElement('h1')
  title.textContent = '⚙️ Settings'
  title.className = 'menu-title'
  title.style.fontSize = '36px'
  title.style.marginBottom = '30px'
  title.style.color = '#ff6600'
  title.style.textShadow = '0 0 10px #ff6600, 0 0 20px #ff6600, 3px 3px 0px #000'
  settingsDiv.appendChild(title)

  const settingsContainer = document.createElement('div')
  settingsContainer.style.maxWidth = '500px'
  settingsContainer.style.width = '90%'
  settingsContainer.style.background = 'rgba(0,0,0,0.5)'
  settingsContainer.style.padding = '25px'
  settingsContainer.style.borderRadius = '15px'
  settingsContainer.style.border = '2px solid rgba(255,255,255,0.1)'

  const settings = settingsManager.getSettings()

  // Music Volume
  const musicSection = createSliderSetting(
    '🎵 Music Volume',
    settings.musicVolume,
    (value) => {
      settingsManager.setMusicVolume(value)
      if (soundManager) soundManager.setMusicVolume(value)
    }
  )
  settingsContainer.appendChild(musicSection)

  // SFX Volume
  const sfxSection = createSliderSetting(
    '🔊 Sound Effects',
    settings.sfxVolume,
    (value) => {
      settingsManager.setSFXVolume(value)
      if (soundManager) soundManager.setSFXVolume(value)
    }
  )
  settingsContainer.appendChild(sfxSection)

  // Screen Shake Toggle
  const shakeSection = createToggleSetting(
    'Screen Shake',
    settings.screenShake,
    (value) => {
      settingsManager.setScreenShake(value)
    }
  )
  settingsContainer.appendChild(shakeSection)

  // Particles Toggle
  const particlesSection = createToggleSetting(
    'Particle Effects',
    settings.particles,
    (value) => {
      settingsManager.setParticles(value)
    }
  )
  settingsContainer.appendChild(particlesSection)

  // Difficulty Selection
  const difficultySection = createDifficultySetting(
    settings.difficulty,
    (value) => {
      settingsManager.setDifficulty(value)
    }
  )
  settingsContainer.appendChild(difficultySection)

  // Character Shape Selection
  const characterShapeSection = createDropdownSetting(
    'Character Shape',
    CHARACTER_SHAPES,
    settings.characterShape || 'sphere',
    (value) => {
      settingsManager.setCharacterShape(value as any)
    }
  )
  settingsContainer.appendChild(characterShapeSection)

  // Player 1 Color
  const player1ColorSection = createColorSetting(
    'Player 1 Color',
    settings.player1Color,
    (value) => {
      settingsManager.setPlayer1Color(value)
    }
  )
  settingsContainer.appendChild(player1ColorSection)

  // Player 2 Color
  const player2ColorSection = createColorSetting(
    'Player 2 Color',
    settings.player2Color,
    (value) => {
      settingsManager.setPlayer2Color(value)
    }
  )
  settingsContainer.appendChild(player2ColorSection)

  settingsDiv.appendChild(settingsContainer)

  // Close Button - styled to match new theme
  const closeButton = document.createElement('button')
  closeButton.textContent = '✓ SAVE & CLOSE'
  closeButton.style.fontFamily = "'Press Start 2P', monospace"
  closeButton.style.fontSize = '14px'
  closeButton.style.padding = '15px 40px'
  closeButton.style.marginTop = '30px'
  closeButton.style.cursor = 'pointer'
  closeButton.style.background = 'linear-gradient(180deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)'
  closeButton.style.color = '#000'
  closeButton.style.border = '3px solid #166534'
  closeButton.style.borderRadius = '8px'
  closeButton.style.fontWeight = 'bold'
  closeButton.style.textShadow = '1px 1px 0 rgba(255,255,255,0.3)'
  closeButton.style.boxShadow = '0 4px 0 #166534, 0 6px 10px rgba(0,0,0,0.4)'
  closeButton.style.transition = 'all 0.1s ease'
  closeButton.style.transform = 'translateY(0)'
  closeButton.addEventListener('click', onClose)
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'linear-gradient(180deg, #86efac 0%, #4ade80 50%, #22c55e 100%)'
    closeButton.style.transform = 'translateY(-2px)'
    closeButton.style.boxShadow = '0 6px 0 #166534, 0 8px 15px rgba(0,0,0,0.5)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'linear-gradient(180deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)'
    closeButton.style.transform = 'translateY(0)'
    closeButton.style.boxShadow = '0 4px 0 #166534, 0 6px 10px rgba(0,0,0,0.4)'
  })
  closeButton.addEventListener('mousedown', () => {
    closeButton.style.transform = 'translateY(4px)'
    closeButton.style.boxShadow = '0 0 0 #166534, 0 2px 5px rgba(0,0,0,0.3)'
  })
  closeButton.addEventListener('mouseup', () => {
    closeButton.style.transform = 'translateY(-2px)'
    closeButton.style.boxShadow = '0 6px 0 #166534, 0 8px 15px rgba(0,0,0,0.5)'
  })
  settingsDiv.appendChild(closeButton)

  return settingsDiv
}

function createDropdownSetting(
  label: string,
  options: { name: string, value: string }[],
  currentValue: string,
  onChange: (value: string) => void
): HTMLDivElement {
  const container = document.createElement('div')
  container.style.marginBottom = '20px'
  container.style.display = 'flex'
  container.style.flexDirection = 'column'

  const labelEl = document.createElement('label')
  labelEl.textContent = label
  labelEl.style.marginBottom = '8px'
  labelEl.style.fontSize = '14px'
  labelEl.style.color = '#ccc'
  container.appendChild(labelEl)

  const select = document.createElement('select')
  select.style.padding = '10px'
  select.style.borderRadius = '5px'
  select.style.border = 'none'
  select.style.background = '#32324e'
  select.style.color = 'white'
  select.style.fontFamily = "'Russo One', sans-serif"
  select.style.fontSize = '14px'
  select.style.cursor = 'pointer'

  options.forEach(opt => {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.name
    if (opt.value === currentValue) {
      option.selected = true
    }
    select.appendChild(option)
  })

  select.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement
    onChange(target.value)
  })

  container.appendChild(select)
  return container
}

function createSliderSetting(
  label: string,
  initialValue: number,
  onChange: (value: number) => void
): HTMLDivElement {
  const section = document.createElement('div')
  section.style.marginBottom = '25px'

  const labelDiv = document.createElement('div')
  labelDiv.style.fontFamily = "'Russo One', sans-serif"
  labelDiv.style.fontSize = '16px'
  labelDiv.style.marginBottom = '12px'
  labelDiv.style.display = 'flex'
  labelDiv.style.justifyContent = 'space-between'
  labelDiv.style.color = '#e5e5e5'

  const labelText = document.createElement('span')
  labelText.textContent = label

  const valueText = document.createElement('span')
  valueText.textContent = `${Math.round(initialValue * 100)}%`
  valueText.style.color = '#fbbf24'
  valueText.style.fontWeight = 'bold'
  valueText.style.textShadow = '0 0 10px rgba(251, 191, 36, 0.5)'

  labelDiv.appendChild(labelText)
  labelDiv.appendChild(valueText)

  const sliderContainer = document.createElement('div')
  sliderContainer.style.position = 'relative'
  sliderContainer.style.height = '20px'
  sliderContainer.style.background = 'linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 100%)'
  sliderContainer.style.borderRadius = '10px'
  sliderContainer.style.border = '2px solid #333'
  sliderContainer.style.overflow = 'hidden'

  const sliderFill = document.createElement('div')
  sliderFill.style.position = 'absolute'
  sliderFill.style.top = '0'
  sliderFill.style.left = '0'
  sliderFill.style.height = '100%'
  sliderFill.style.width = `${Math.round(initialValue * 100)}%`
  sliderFill.style.background = 'linear-gradient(90deg, #f97316, #fbbf24)'
  sliderFill.style.borderRadius = '8px'
  sliderFill.style.transition = 'width 0.1s ease'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '100'
  slider.value = String(Math.round(initialValue * 100))
  slider.style.position = 'absolute'
  slider.style.top = '0'
  slider.style.left = '0'
  slider.style.width = '100%'
  slider.style.height = '100%'
  slider.style.opacity = '0'
  slider.style.cursor = 'pointer'

  slider.addEventListener('input', () => {
    const value = parseInt(slider.value) / 100
    valueText.textContent = `${slider.value}%`
    sliderFill.style.width = `${slider.value}%`
    onChange(value)
  })

  sliderContainer.appendChild(sliderFill)
  sliderContainer.appendChild(slider)

  section.appendChild(labelDiv)
  section.appendChild(sliderContainer)

  return section
}

function createToggleSetting(
  label: string,
  initialValue: boolean,
  onChange: (value: boolean) => void
): HTMLDivElement {
  const section = document.createElement('div')
  section.style.marginBottom = '25px'
  section.style.display = 'flex'
  section.style.justifyContent = 'space-between'
  section.style.alignItems = 'center'

  const labelText = document.createElement('span')
  labelText.textContent = label
  labelText.style.fontFamily = "'Russo One', sans-serif"
  labelText.style.fontSize = '16px'
  labelText.style.color = '#e5e5e5'

  // Create toggle switch container
  const toggleContainer = document.createElement('div')
  toggleContainer.style.position = 'relative'
  toggleContainer.style.width = '70px'
  toggleContainer.style.height = '32px'
  toggleContainer.style.cursor = 'pointer'

  const toggleTrack = document.createElement('div')
  toggleTrack.style.position = 'absolute'
  toggleTrack.style.top = '0'
  toggleTrack.style.left = '0'
  toggleTrack.style.width = '100%'
  toggleTrack.style.height = '100%'
  toggleTrack.style.borderRadius = '16px'
  toggleTrack.style.background = initialValue 
    ? 'linear-gradient(90deg, #22c55e, #4ade80)' 
    : 'linear-gradient(90deg, #374151, #4b5563)'
  toggleTrack.style.border = '2px solid ' + (initialValue ? '#166534' : '#1f2937')
  toggleTrack.style.transition = 'all 0.2s ease'
  toggleTrack.style.boxShadow = initialValue 
    ? '0 0 10px rgba(34, 197, 94, 0.5), inset 0 2px 4px rgba(0,0,0,0.2)' 
    : 'inset 0 2px 4px rgba(0,0,0,0.3)'

  const toggleKnob = document.createElement('div')
  toggleKnob.style.position = 'absolute'
  toggleKnob.style.top = '4px'
  toggleKnob.style.left = initialValue ? '40px' : '4px'
  toggleKnob.style.width = '24px'
  toggleKnob.style.height = '24px'
  toggleKnob.style.borderRadius = '50%'
  toggleKnob.style.background = 'linear-gradient(180deg, #fff 0%, #e5e5e5 100%)'
  toggleKnob.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)'
  toggleKnob.style.transition = 'left 0.2s ease'

  const toggleLabel = document.createElement('span')
  toggleLabel.style.position = 'absolute'
  toggleLabel.style.top = '50%'
  toggleLabel.style.transform = 'translateY(-50%)'
  toggleLabel.style.fontFamily = "'Press Start 2P', monospace"
  toggleLabel.style.fontSize = '8px'
  toggleLabel.style.fontWeight = 'bold'
  toggleLabel.style.color = initialValue ? '#166534' : '#9ca3af'
  toggleLabel.style.left = initialValue ? '8px' : '32px'
  toggleLabel.textContent = initialValue ? 'ON' : 'OFF'
  toggleLabel.style.transition = 'all 0.2s ease'

  toggleContainer.appendChild(toggleTrack)
  toggleContainer.appendChild(toggleLabel)
  toggleContainer.appendChild(toggleKnob)

  let isOn = initialValue
  toggleContainer.addEventListener('click', () => {
    isOn = !isOn
    toggleKnob.style.left = isOn ? '40px' : '4px'
    toggleTrack.style.background = isOn 
      ? 'linear-gradient(90deg, #22c55e, #4ade80)' 
      : 'linear-gradient(90deg, #374151, #4b5563)'
    toggleTrack.style.border = '2px solid ' + (isOn ? '#166534' : '#1f2937')
    toggleTrack.style.boxShadow = isOn 
      ? '0 0 10px rgba(34, 197, 94, 0.5), inset 0 2px 4px rgba(0,0,0,0.2)' 
      : 'inset 0 2px 4px rgba(0,0,0,0.3)'
    toggleLabel.textContent = isOn ? 'ON' : 'OFF'
    toggleLabel.style.color = isOn ? '#166534' : '#9ca3af'
    toggleLabel.style.left = isOn ? '8px' : '32px'
    onChange(isOn)
  })

  section.appendChild(labelText)
  section.appendChild(toggleContainer)

  return section
}

function createDifficultySetting(
  initialValue: 'easy' | 'medium' | 'hard',
  onChange: (value: 'easy' | 'medium' | 'hard') => void
): HTMLDivElement {
  const section = document.createElement('div')
  section.style.marginBottom = '25px'

  const labelDiv = document.createElement('div')
  labelDiv.textContent = 'Difficulty'
  labelDiv.style.fontFamily = "'Russo One', sans-serif"
  labelDiv.style.fontSize = '16px'
  labelDiv.style.marginBottom = '12px'
  labelDiv.style.color = '#e5e5e5'

  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.display = 'flex'
  buttonsDiv.style.gap = '10px'

  const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard']
  const difficultyColors = {
    easy: { bg: '#22c55e', glow: 'rgba(34,197,94,0.5)', border: '#166534' },
    medium: { bg: '#f59e0b', glow: 'rgba(245,158,11,0.5)', border: '#b45309' },
    hard: { bg: '#ef4444', glow: 'rgba(239,68,68,0.5)', border: '#b91c1c' }
  }
  const buttons: HTMLButtonElement[] = []

  difficulties.forEach(diff => {
    const button = document.createElement('button')
    button.textContent = diff.toUpperCase()
    button.style.flex = '1'
    button.style.padding = '12px 8px'
    button.style.fontFamily = "'Press Start 2P', monospace"
    button.style.fontSize = '10px'
    button.style.cursor = 'pointer'
    button.style.borderRadius = '8px'
    button.style.fontWeight = 'bold'
    button.style.transition = 'all 0.2s ease'
    
    const isSelected = diff === initialValue
    const colors = difficultyColors[diff]
    
    if (isSelected) {
      button.style.background = `linear-gradient(180deg, ${colors.bg} 0%, ${colors.border} 100%)`
      button.style.border = `3px solid ${colors.border}`
      button.style.color = '#fff'
      button.style.boxShadow = `0 0 15px ${colors.glow}, 0 4px 0 ${colors.border}`
      button.style.transform = 'translateY(-2px)'
    } else {
      button.style.background = 'linear-gradient(180deg, #374151 0%, #1f2937 100%)'
      button.style.border = '3px solid #4b5563'
      button.style.color = '#9ca3af'
      button.style.boxShadow = '0 4px 0 #1f2937'
      button.style.transform = 'translateY(0)'
    }

    button.addEventListener('mouseenter', () => {
      if (button.style.color === 'rgb(156, 163, 175)') { // not selected
        button.style.background = 'linear-gradient(180deg, #4b5563 0%, #374151 100%)'
        button.style.color = '#e5e5e5'
      }
    })

    button.addEventListener('mouseleave', () => {
      if (button.style.color !== 'rgb(255, 255, 255)') { // not selected
        button.style.background = 'linear-gradient(180deg, #374151 0%, #1f2937 100%)'
        button.style.color = '#9ca3af'
      }
    })

    button.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.style.background = 'linear-gradient(180deg, #374151 0%, #1f2937 100%)'
        b.style.border = '3px solid #4b5563'
        b.style.color = '#9ca3af'
        b.style.boxShadow = '0 4px 0 #1f2937'
        b.style.transform = 'translateY(0)'
      })
      const c = difficultyColors[diff]
      button.style.background = `linear-gradient(180deg, ${c.bg} 0%, ${c.border} 100%)`
      button.style.border = `3px solid ${c.border}`
      button.style.color = '#fff'
      button.style.boxShadow = `0 0 15px ${c.glow}, 0 4px 0 ${c.border}`
      button.style.transform = 'translateY(-2px)'
      onChange(diff)
    })

    buttons.push(button)
    buttonsDiv.appendChild(button)
  })

  section.appendChild(labelDiv)
  section.appendChild(buttonsDiv)

  return section
}

function createColorSetting(
  label: string,
  initialValue: string,
  onChange: (value: string) => void
): HTMLDivElement {
  const section = document.createElement('div')
  section.style.marginBottom = '25px'

  const labelDiv = document.createElement('div')
  labelDiv.textContent = label
  labelDiv.style.fontFamily = "'Russo One', sans-serif"
  labelDiv.style.fontSize = '16px'
  labelDiv.style.marginBottom = '12px'
  labelDiv.style.color = '#e5e5e5'

  const colorsDiv = document.createElement('div')
  colorsDiv.style.display = 'flex'
  colorsDiv.style.flexWrap = 'wrap'
  colorsDiv.style.gap = '8px'

  const colorButtons: HTMLButtonElement[] = []

  PLAYER_COLORS.forEach(colorOption => {
    const button = document.createElement('button')
    button.style.width = '40px'
    button.style.height = '40px'
    button.style.borderRadius = '50%'
    button.style.cursor = 'pointer'
    button.style.transition = 'all 0.2s ease'
    button.style.position = 'relative'
    button.title = colorOption.name
    
    const isSelected = colorOption.value === initialValue
    
    button.style.background = colorOption.value
    button.style.border = isSelected 
      ? '3px solid #fff' 
      : '3px solid rgba(255,255,255,0.2)'
    button.style.boxShadow = isSelected 
      ? `0 0 15px ${colorOption.value}, 0 0 25px ${colorOption.value}` 
      : 'none'
    button.style.transform = isSelected ? 'scale(1.15)' : 'scale(1)'

    // Add checkmark for selected
    if (isSelected) {
      button.textContent = '✓'
      button.style.color = '#000'
      button.style.fontWeight = 'bold'
      button.style.fontSize = '18px'
      button.style.textShadow = '0 0 3px rgba(255,255,255,0.5)'
    }

    button.addEventListener('mouseenter', () => {
      if (button.style.transform !== 'scale(1.15)') {
        button.style.transform = 'scale(1.1)'
        button.style.boxShadow = `0 0 10px ${colorOption.value}`
      }
    })

    button.addEventListener('mouseleave', () => {
      if (!button.textContent) {
        button.style.transform = 'scale(1)'
        button.style.boxShadow = 'none'
      }
    })

    button.addEventListener('click', () => {
      // Deselect all
      colorButtons.forEach(b => {
        b.textContent = ''
        b.style.border = '3px solid rgba(255,255,255,0.2)'
        b.style.boxShadow = 'none'
        b.style.transform = 'scale(1)'
      })
      
      // Select this one
      button.textContent = '✓'
      button.style.color = '#000'
      button.style.fontWeight = 'bold'
      button.style.fontSize = '18px'
      button.style.textShadow = '0 0 3px rgba(255,255,255,0.5)'
      button.style.border = '3px solid #fff'
      button.style.boxShadow = `0 0 15px ${colorOption.value}, 0 0 25px ${colorOption.value}`
      button.style.transform = 'scale(1.15)'
      
      onChange(colorOption.value)
    })

    colorButtons.push(button)
    colorsDiv.appendChild(button)
  })

  section.appendChild(labelDiv)
  section.appendChild(colorsDiv)

  return section
}
