import React, { useState } from 'react';
import ItemNode from './ItemNode';
import './Folder.css';
import './File.css';
import { useRecoilState } from 'recoil';
import { selectedFile } from '../../recoil/atom';

//MUI
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';

const Folder = ({ name, children, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [r_selectreItem] = useRecoilState(selectedFile);

  const iconClassName = `folder-name ${
    r_selectreItem === name ? 'selected' : ''
  }`;
  return (
    <div>
      <span
        onClick={() => {
          setIsOpen(!isOpen);
          onSelect(name);
        }}
        className={iconClassName}
      >
        <span className="folder-chevron">
          {isOpen ? (
            <KeyboardArrowDownRoundedIcon />
          ) : (
            <KeyboardArrowRightRoundedIcon />
          )}
        </span>
        <span className="folder-icon">
          <FolderRoundedIcon />
        </span>
        <span className="folder-label">{name}</span>
      </span>
      {isOpen && children && (
        <div className="tree-children">
          {children.map((child, index) => (
            <ItemNode key={index} {...child} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Folder;
