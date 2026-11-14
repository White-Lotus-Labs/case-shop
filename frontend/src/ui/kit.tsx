// Fujitora × NEAR Component Kit: Futuristic Web3 buttons, segmented control,
// cards, activity indicators, sheet dialog, and anime/web3 themed glyphs.

import { useEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ---------- glyphs ----------

export type GlyphName =
  | 'xmark'
  | 'minus'
  | 'plus'
  | 'chevron-down'
  | 'chevron-up'
  | 'shippingbox'
  | 'speaker'
  | 'speaker-xmark'
  | 'near'
  | 'meteor'
  | 'gravity'
  | 'dice'
  | 'sparkle'

export function Glyph({ name, className = 'size-4' }: { name: GlyphName; className?: string }) {
  const speaker = <path d="M2.5 6.2h2.1L7.8 3.6v8.8L4.6 9.8H2.5z" fill="currentColor" stroke="none" />
  const paths: Record<GlyphName, ReactNode> = {
    near: (
      <path
        d="M4.5 13.5V2.5l7 11V2.5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    meteor: (
      <>
        <circle cx="10" cy="6" r="3" fill="currentColor" stroke="none" />
        <path d="M7 9L2 14M8 12L3 15M11 9L7 15" strokeWidth="1.5" />
      </>
    ),
    gravity: (
      <>
        <circle cx="8" cy="8" r="6" strokeDasharray="3 2" />
        <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
      </>
    ),
    dice: (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" strokeWidth="1.5" />
        <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="8" cy="8" r="1.2" fill="#00EC97" stroke="none" />
      </>
    ),
    sparkle: (
      <path
        d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5L8 2z"
        fill="currentColor"
        stroke="none"
      />
    ),
    speaker: (
      <>
        {speaker}
        <path d="M10.2 6.1a2.6 2.6 0 0 1 0 3.8M12.1 4.4a5 5 0 0 1 0 7.2" />
      </>
    ),
    'speaker-xmark': (
      <>
        {speaker}
        <path d="M10.4 6.3l3.2 3.4m0-3.4l-3.2 3.4" />
      </>
    ),
    xmark: <path d="M4.5 4.5l7 7m0-7l-7 7" />,
    minus: <path d="M3.5 8h9" />,
    plus: <path d="M8 3.5v9M3.5 8h9" />,
    'chevron-down': <path d="M4 6l4 4 4-4" />,
    'chevron-up': <path d="M4 10l4-4 4 4" />,
    shippingbox: (
      <>
        <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z" />
        <path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  )
}

// ---------- activity indicator ----------

export function ActivityIndicator({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ animation: 'spokes 0.75s steps(8) infinite' }} aria-label="Loading" role="img">
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="7.1" y="1" width="1.8" height="4.2" rx="0.9" fill="currentColor" opacity={0.25 + (i / 8) * 0.75} transform={`rotate(${i * 45} 8 8)`} />
      ))}
    </svg>
  )
}

// ---------- button ----------

type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'purple'
type ButtonSize = 'small' | 'medium' | 'large'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  filled: 'bg-gradient-to-r from-[#00EC97] to-[#00c982] text-[#060818] font-bold tracking-[0.02em] shadow-[0_0_20px_rgba(0,236,151,0.35)] enabled:hover:shadow-[0_0_28px_rgba(0,236,151,0.6)] enabled:hover:scale-[1.01] disabled:bg-fill-3 disabled:text-label-3',
  purple: 'bg-gradient-to-r from-[#9d4edd] to-[#7928ca] text-white font-bold tracking-[0.02em] shadow-[0_0_20px_rgba(157,78,221,0.35)] enabled:hover:shadow-[0_0_28px_rgba(157,78,221,0.6)] enabled:hover:scale-[1.01] disabled:bg-fill-3 disabled:text-label-3',
  tinted: 'bg-[#00EC97]/15 text-[#00EC97] border border-[#00EC97]/30 enabled:hover:bg-[#00EC97]/25 enabled:hover:border-[#00EC97]/60 disabled:bg-fill-3 disabled:text-label-3',
  gray: 'bg-fill-3 text-label border border-purple-500/15 enabled:hover:bg-fill-2 enabled:hover:border-purple-500/30 disabled:text-label-3',
  plain: 'text-[#00EC97] enabled:hover:text-[#4df5b5] disabled:text-label-3',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  small: 'h-[32px] gap-1.5 rounded-full px-3.5 text-[13px] font-semibold tracking-[-0.006em]',
  medium: 'h-[36px] gap-1.5 rounded-[10px] px-4 text-[14px] font-semibold tracking-[-0.012em]',
  large: 'h-[52px] gap-2 rounded-[14px] px-6 text-[16px] font-bold tracking-[0.02em]',
}

export function Button({
  variant = 'gray',
  size = 'medium',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-all duration-200 ease-[var(--ease-standard)] enabled:active:scale-[0.97] disabled:cursor-not-allowed',
        BUTTON_VARIANT[variant],
        variant !== 'plain' || size !== 'small' ? BUTTON_SIZE[size] : 'gap-1 text-[14px]',
        loading && 'disabled:opacity-100',
        className,
      )}
      {...rest}
    >
      {loading && <ActivityIndicator />}
      {children}
    </button>
  )
}

// ---------- segmented control ----------

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
  renderOption,
  size = 'regular',
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
  label: string
  renderOption?: (v: T, selected: boolean) => ReactNode
  size?: 'regular' | 'large'
}) {
  const index = Math.max(0, options.indexOf(value))
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const n = options.length
  const onKey = (e: KeyboardEvent) => {
    if (disabled || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    e.preventDefault()
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
    onChange(options[next])
    refs.current[next]?.focus()
  }
  const large = size === 'large'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKey}
      className={cx(
        'relative grid rounded-[12px] bg-[#0c0f2b]/90 border border-purple-500/25 p-[3px] shadow-[0_8px_24px_rgba(0,0,0,0.5)]',
        large ? 'min-h-[56px]' : 'h-9',
        disabled && 'opacity-50'
      )}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {options.slice(1).map((_, i) =>
        i + 1 === index || i === index ? null : (
          <span
            key={i}
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-purple-500/20"
            style={{ left: `calc(3px + (100% - 6px) * ${(i + 1) / n})` }}
          />
        ),
      )}
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-[3px] bottom-[3px] left-[3px] bg-gradient-to-b from-[#2a1d52] to-[#1a1438] border border-purple-400/35 shadow-[0_4px_16px_rgba(157,78,221,0.25),inset_0_1px_0_rgba(255,255,255,0.12)] transition-transform duration-300 ease-[var(--ease-spring)]',
          large ? 'rounded-[10px]' : 'rounded-[8px]',
        )}
        style={{ width: `calc((100% - 6px) / ${n})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o, i) => {
        const selected = o === value
        return (
          <button
            key={o}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={cx(
              'relative z-10 flex min-w-0 items-center justify-center rounded-[8px] px-2 text-[13px] tracking-[-0.006em] outline-offset-0 transition-all disabled:cursor-not-allowed',
              selected ? 'font-bold text-white drop-shadow-[0_0_8px_rgba(0,236,151,0.4)]' : 'font-medium text-label-2 hover:text-white',
            )}
          >
            {renderOption ? renderOption(o, selected) : o}
          </button>
        )
      })}
    </div>
  )
}

// ---------- stepper ----------

export function Stepper({
  value,
  min,
  max,
  onChange,
  disabled,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
  label: string
}) {
  const half = 'grid h-8 w-[46px] place-items-center text-label transition-colors enabled:active:bg-fill-2 disabled:text-label-4 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <span className="tnum t-body min-w-[1.5ch] text-right font-semibold" aria-live="polite">
        {value}
      </span>
      <div className={cx('flex items-center overflow-hidden rounded-[8px] bg-fill-3 border border-purple-500/20', disabled && 'opacity-50')}>
        <button type="button" className={half} aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
          <Glyph name="minus" className="size-[15px]" />
        </button>
        <span className="h-[18px] w-px bg-separator" aria-hidden="true" />
        <button type="button" className={half} aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
          <Glyph name="plus" className="size-[15px]" />
        </button>
      </div>
    </div>
  )
}

// ---------- inset grouped list ----------

export function Section({
  header,
  footer,
  children,
  className,
  glass,
}: {
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  glass?: boolean
}) {
  return (
    <section className={cx('flex flex-col gap-1.5', className)}>
      {header && <h2 className="t-footnote px-4 text-label-2 font-medium tracking-wide uppercase text-[11px]">{header}</h2>}
      <div className={cx('overflow-hidden rounded-[14px] border border-purple-500/20 shadow-inner', glass ? 'bg-[#0e1233]/70 backdrop-blur-md' : 'bg-bg-2')}>{children}</div>
      {footer && <p className="t-footnote px-4 text-label-2">{footer}</p>}
    </section>
  )
}

export function Row({ title, detail, accessory, leading }: { title: ReactNode; detail?: ReactNode; accessory?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="group/row relative flex min-h-[44px] items-center gap-3 px-4 py-2">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-body truncate text-[14px]">{title}</span>
        {detail && <span className="t-subheadline text-label-2 text-[12px]">{detail}</span>}
      </div>
      {accessory && <div className="t-body tnum flex shrink-0 items-center gap-2 text-label-2 text-[13px]">{accessory}</div>}
      <span className="absolute right-0 bottom-0 left-4 h-px scale-y-50 bg-purple-500/15 group-last/row:hidden" aria-hidden="true" />
    </div>
  )
}

// ---------- sheet (native <dialog>) ----------

export function Sheet({
  open,
  onClose,
  title,
  children,
  toolbar,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  toolbar?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <header className="hairline-b grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4 bg-[#0a0d24]">
        <div className="flex items-center gap-1.5 text-[#00EC97]">
          <Glyph name="near" className="size-4" />
          <span className="font-display text-[11px] font-bold tracking-wider">HACKATHON</span>
        </div>
        <h2 className="font-display text-[16px] font-bold tracking-wide text-white">{title}</h2>
        <div className="flex justify-end">
          <Button variant="plain" size="small" onClick={onClose} className="font-semibold text-[#00EC97]">
            Close
          </Button>
        </div>
      </header>
      {toolbar && <div className="shrink-0 px-5 pt-4">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </dialog>
  )
}
