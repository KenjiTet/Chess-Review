/** Modal shown when sharing a position — displays an engaging challenge prompt and a copyable link. */

import { useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import shareIconUrl from '../../assets/share_icon.svg';
import copyIconUrl from '../../assets/copy_icon.svg';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  url: string;
  classification: string;
  blunderDescription: string;
  onClose: () => void;
}

function ShareModal({ isOpen, url, classification, blunderDescription, onClose }: ShareModalProps): JSX.Element | null {
  const [copied, setCopied] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset the copied flag when the modal closes
      setCopied(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      inputRef.current?.select();
    }, 80);

    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function handleCopy(): void {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2500);
    });
  }

  function handleBackdropClick(): void {
    onClose();
  }

  function handleCardClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="spm-backdrop" onClick={handleBackdropClick}>
      <div className="spm-card" onClick={handleCardClick}>

        {/* Header */}
        <div className="spm-header">
          <img className="spm-header__icon" src={shareIconUrl} alt="" aria-hidden="true" />
          <span className="spm-header__title">Challenge a Friend</span>
          <button
            className="spm-header__close"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Challenge text */}
        <div className="spm-challenge">
          <p className="spm-challenge__headline">Share the position</p>
          <p className="spm-challenge__body">
            Share this position and see if your friends can find what you missed.
          </p>
        </div>

        {/* Position badge */}
        <div className="spm-position">
          <span className={`spm-position__badge spm-position__badge--${classification}`}>
            {classification}
          </span>
          <p className="spm-position__desc">{blunderDescription}</p>
        </div>

        {/* Link copy row */}
        <div className="spm-link">
          <input
            ref={inputRef}
            className="spm-link__input"
            type="text"
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Shareable link"
          />
          <button
            className={`spm-link__copy${copied ? ' spm-link__copy--done' : ''}`}
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy link'}
          >
            {copied
              ? <span className="spm-link__copy-check">✓</span>
              : <img className="spm-link__copy-ic" src={copyIconUrl} alt="Copy" />
            }
          </button>
        </div>

        {copied && (
          <p className="spm-copied-hint">Link copied — send it to anyone!</p>
        )}

      </div>
    </div>
  );
}

export default ShareModal;
