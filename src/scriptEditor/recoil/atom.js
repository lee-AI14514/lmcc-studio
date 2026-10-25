import { atom } from 'recoil';

export const selectedFile = atom({
  key: 'selectedItem', 
  default: null, 
});

export const currentTab = atom({
  key: 'currentTab', 
  default: null, 
});

export const tabTable = atom({
  key: 'tabTable', 
  default: [], 
});


///////


export const directoryContentState = atom ({
  key: 'directoryContentState', // 고유한 키
  default: [], // 기본값
});


///////
export const deleteTab = atom ({
  key: 'deleteTab', // 고유한 키
  default: null, // 기본값
});

// The paper library under ~/.lmcc-studio. `papers` contains normalized paper
// objects (see src/papers/paperModel.js), not raw IPC payloads.
export const paperLibraryState = atom({
  key: 'paperLibraryState',
  default: {
    status: 'idle', // idle | loading | ready | error
    root: null,
    activeId: null,
    papers: [],
    error: null,
    truncated: false,
  },
});