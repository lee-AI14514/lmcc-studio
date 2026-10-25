import styled, { css } from 'styled-components';

export const Nav = styled.nav`
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 8px 8px 0;
  background-color: var(--bg-app);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

export const NavItem = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 9px 0 12px;
  border: none;
  border-radius: 9px 9px 0 0;
  background-color: transparent;
  color: ${({ $active }) => ($active ? 'var(--text)' : 'var(--text-muted)')};
  font-family: var(--font-ui);
  font-size: 12.5px;
  letter-spacing: 0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.16s ease, color 0.16s ease;

  &::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: 0;
    height: 2px;
    border-radius: 0 0 2px 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  ${({ $active }) =>
    $active &&
    css`
      background-color: var(--bg-panel);

      &::after {
        opacity: 1;
      }
    `}

  &:hover {
    background-color: ${({ $active }) =>
      $active ? 'var(--bg-panel)' : 'var(--bg-hover)'};
    color: var(--text);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`;

export const WrapButton = styled.button`
  height: 100%;
  display: flex;
  align-items: center;
  border: none;
  margin-left: auto;
  background-color: ${({ active }) =>
    active ? 'transparent' : 'var(--bg-elevated)'};
  color: var(--text-secondary);

  &:focus {
    border: none;
    outline: none;
  }
`;

export const CloseButton = styled.div`
  width: 18px;
  height: 18px;
  margin-left: 2px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--text-muted);
  background-color: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;

  &:hover {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.09);
  }
`;

export const UnsavedDot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--accent-bright);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.75);
`;
