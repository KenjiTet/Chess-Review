/** Modal shown when saving a position to favorites — lets the user add an optional note. */

import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import './SaveFavoriteModal.css';

interface SaveFavoriteModalProps {
  isOpen: boolean;
  classification: string;
  blunderDescription: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

function SaveFavoriteModal({
  isOpen,
  classification,
  blunderDescription,
  onConfirm,
  onCancel,
}: SaveFavoriteModalProps): JSX.Element | null {
  const [note, setNote] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea and reset note each time modal opens.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setNote('');
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Close on Escape key.
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        onCancel();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  function handleConfirm(): void {
    onConfirm(note.trim());
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl/Cmd+Enter confirms.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleConfirm();
    }
  }

  function handleBackdropClick(): void {
    onCancel();
  }

  function handleCardClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="sfm-backdrop" onClick={handleBackdropClick}>
      <div className="sfm-card" onClick={handleCardClick}>

        {/* Header */}
        <div className="sfm-header">
          <span className="sfm-header__icon">★</span>
          <span className="sfm-header__title">Save Position</span>
          <button
            className="sfm-header__close"
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>

        {/* Position preview */}
        <div className="sfm-preview">
          <span className={`sfm-preview__badge sfm-preview__badge--${classification}`}>
            {classification}
          </span>
          <p className="sfm-preview__desc">{blunderDescription}</p>
        </div>

        {/* Note input */}
        <div className="sfm-field">
          <label className="sfm-field__label" htmlFor="sfm-note">
            Note
            <span className="sfm-field__optional">optional</span>
          </label>
          <textarea
            id="sfm-note"
            ref={textareaRef}
            className="sfm-field__textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="What do you want to remember about this position?"
            rows={3}
            maxLength={500}
          />
          <span className="sfm-field__hint">Ctrl+Enter to save</span>
        </div>

        {/* Actions */}
        <div className="sfm-actions">
          <button
            className="sfm-actions__cancel"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="sfm-actions__save"
            type="button"
            onClick={handleConfirm}
          >
            Save Position
          </button>
        </div>

      </div>
    </div>
  );
}

export default SaveFavoriteModal;
