/** Dropdown select for blunder threshold (cp loss), styled like TimeClassSelect. */

import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import './ThresholdPicker.css';

const STEPS = [100, 200, 300, 400, 500] as const;
type ThresholdStep = (typeof STEPS)[number];

interface ThresholdPickerProps {
  value: number;
  onChange: (v: number) => void;
}

function ThresholdPicker({ value, onChange }: ThresholdPickerProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  function handleToggle(): void {
    setOpen((prev) => !prev);
  }

  function handleSelect(step: ThresholdStep): void {
    onChange(step);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="threshold-picker">
      <button
        type="button"
        className="threshold-picker__trigger"
        onClick={handleToggle}
      >
        <span className="threshold-picker__label">{value} cp</span>
        <svg
          className={`threshold-picker__chevron${open ? ' threshold-picker__chevron--open' : ''}`}
          viewBox="0 0 10 6"
          fill="currentColor"
        >
          <path d="M0 0l5 6 5-6z" />
        </svg>
      </button>

      {open && (
        <ul className="threshold-picker__menu">
          {STEPS.map((step, index) => (
            <li
              key={`threshold-${step}-${index}`}
              className={`threshold-picker__option${step === value ? ' threshold-picker__option--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(step);
              }}
            >
              <span>{step} cp</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ThresholdPicker;
