// Apple HIG component kit: buttons, activity indicator, segmented control, stepper,
// inset grouped lists, sheet, and a few SF Symbols–style glyphs. No third-party UI library.

import { useEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ---------- glyphs ----------

type GlyphName = 'xmark' | 'minus' | 'plus' | 'chevron-down' | 'chevron-up' | 'shippingbox' | 'speaker' | 'speaker-xmark'

export function Glyph({ name, className = 'size-4' }: { name: GlyphName; className?: string }) {
  const speaker = <path d="M2.5 6.2h2.1L7.8 3.6v8.8L4.6 9.8H2.5z" fill="currentColor" stroke="none" />
  const paths: Record<string, ReactNode> = {
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

// ---------- activity indicator (8 spokes, stepped rotation) ----------

export function ActivityIndicator({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ animation: 'spokes 0.8s steps(8) infinite' }} aria-label="Loading" role="img">
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="7.1" y="1" width="1.8" height="4.2" rx="0.9" fill="currentColor" opacity={0.2 + (i / 8) * 0.8} transform={`rotate(${i * 45} 8 8)`} />
      ))}
    </svg>
  )
}

// ---------- button ----------

type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain'
type ButtonSize = 'small' | 'medium' | 'large'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  filled: 'bg-tint text-white enabled:hover:brightness-110 disabled:bg-fill-3 disabled:text-label-3',
  tinted: 'bg-tint/20 text-[#409cff] enabled:hover:bg-tint/25 disabled:bg-fill-3 disabled:text-label-3',
  gray: 'bg-fill-3 text-label enabled:hover:bg-fill-2 disabled:text-label-3',
  plain: 'text-[#409cff] enabled:hover:text-[#66b0ff] disabled:text-label-3',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  small: 'h-[30px] gap-1 rounded-full px-3 text-[13px] font-semibold tracking-[-0.006em]',
  medium: 'h-[34px] gap-1.5 rounded-[10px] px-3.5 text-[15px] font-semibold tracking-[-0.015em]',
  large: 'h-[50px] gap-2 rounded-[14px] px-5 text-[17px] font-semibold tracking-[-0.024em]',
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
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-[background-color,color,filter,opacity,transform] duration-150 ease-[var(--ease-standard)] enabled:active:scale-[0.97] enabled:active:opacity-70 disabled:cursor-not-allowed',
        BUTTON_VARIANT[variant],
        variant !== 'plain' || size !== 'small' ? BUTTON_SIZE[size] : 'gap-1 text-[15px]',
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
      className={cx('relative grid rounded-[9px] bg-fill-3 p-[2px]', large ? 'min-h-[52px] rounded-[12px]' : 'h-8', disabled && 'opacity-50')}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {/* separators between unselected neighbours */}
      {options.slice(1).map((_, i) =>
        i + 1 === index || i === index ? null : (
          <span
            key={i}
            aria-hidden="true"
            className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-separator"
            style={{ left: `calc(2px + (100% - 4px) * ${(i + 1) / n})` }}
          />
        ),
      )}
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-[2px] bottom-[2px] left-[2px] bg-thumb shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04),inset_0_0.5px_0_rgb(255_255_255/0.08)] transition-transform duration-300 ease-[var(--ease-spring)]',
          large ? 'rounded-[10px]' : 'rounded-[7px]',
        )}
        style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${index * 100}%)` }}
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
              'relative z-10 flex min-w-0 items-center justify-center rounded-[7px] px-2 text-[13px] tracking-[-0.006em] outline-offset-0 transition-[font-weight,color] disabled:cursor-not-allowed',
              selected ? 'font-semibold text-label' : 'font-medium text-label',
            )}
          >
            {renderOption ? renderOption(o, selected) : o}
          </button>
        )
      })}
    </div>
  )
}

// ---------- stepper (UIStepper) ----------

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
      <span className="tnum t-body min-w-[1.5ch] text-right" aria-live="polite">
        {value}
      </span>
      <div className={cx('flex items-center overflow-hidden rounded-[8px] bg-fill-3', disabled && 'opacity-50')}>
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
  /** for groups placed on a translucent material instead of a solid background */
  glass?: boolean
}) {
  return (
    <section className={cx('flex flex-col gap-1.5', className)}>
      {header && <h2 className="t-footnote px-4 text-label-2">{header}</h2>}
      <div className={cx('overflow-hidden rounded-[12px]', glass ? 'bg-white/[0.06]' : 'bg-bg-2')}>{children}</div>
      {footer && <p className="t-footnote px-4 text-label-2">{footer}</p>}
    </section>
  )
}

export function Row({ title, detail, accessory, leading }: { title: ReactNode; detail?: ReactNode; accessory?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="group/row relative flex min-h-[44px] items-center gap-3 px-4 py-1.5">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-body truncate">{title}</span>
        {detail && <span className="t-subheadline text-label-2">{detail}</span>}
      </div>
      {accessory && <div className="t-body tnum flex shrink-0 items-center gap-2 text-label-2">{accessory}</div>}
      {/* inset separator, hidden on the last row */}
      <span className="absolute right-0 bottom-0 left-4 h-px scale-y-50 bg-separator group-last/row:hidden" aria-hidden="true" />
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
      <header className="hairline-b grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4">
        <span />
        <h2 className="t-headline">{title}</h2>
        <div className="flex justify-end">
          <Button variant="plain" size="small" onClick={onClose} className="t-headline">
            Done
          </Button>
        </div>
      </header>
      {toolbar && <div className="shrink-0 px-4 pt-4">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </dialog>
  )
}
