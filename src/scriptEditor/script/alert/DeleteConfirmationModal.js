import React, { useEffect } from 'react';
import './DeleteConfirmationModal.css';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

function DeleteConfirmationModal({ targetTiTle, isOpen, error, onClose, onSave, onDontSave }) {
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
                <div className="modal-header">
                    <span className="modal-icon">
                        <WarningAmberRoundedIcon sx={{ fontSize: 19 }} />
                    </span>
                    <div className="modal-titles">
                        <span className="modal-eyebrow">LMCC Studio</span>
                        <h2 className="modal-title" id="unsaved-title">저장되지 않은 변경 사항</h2>
                    </div>
                </div>
                <div className="modal-body">
                    <h3>{targetTiTle}에 대한 변경 내용을 저장하겠습니까?</h3>
                    <p>변경 내용을 저장하지 않으면 손실됩니다.</p>
                    {error ? <p className="modal-error" role="alert">{error}</p> : null}
                </div>
                <div className="modal-footer">
                    <button onClick={onSave} className="button button-save">저장(S)</button>
                    <button onClick={onDontSave} className="button button-dont-save">저장 안 함(N)</button>
                    <button onClick={onClose} className="button button-cancel">취소</button>
                </div>
            </div>
        </div>
    );
}

export default DeleteConfirmationModal;
