interface ToggleProps {
  checked: boolean | null
  onChange: (value: boolean) => void
}

export function Toggle({ checked, onChange }: ToggleProps) {
  const on = checked === true
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet focus:ring-offset-1 ${
        on ? 'bg-violet' : 'bg-line'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white transform transition-transform duration-200 ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
