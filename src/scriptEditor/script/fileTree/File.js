import React from 'react';
import { useRecoilState } from 'recoil';
import { selectedFile, currentTab, tabTable } from '../../recoil/atom';
import './File.css';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import system from '../../../system/system';
import { v4 as uuidv4 } from 'uuid';
import { ensureLmccTab } from '../../../lmcc/useLmccActions';
import { readQuestionSource } from '../../../lmcc/questionAssets';

const File = ({ name, path, onSelect }) => {
  const [r_selectedItem] = useRecoilState(selectedFile);
  const [r_currentTab, set_r_currentTab] = useRecoilState(currentTab);
  const [r_tabTable, set_r_tabTable] = useRecoilState(tabTable);
  const isLmccFile = /\.lmcc$/i.test(name);

  const className = `file-name ${
    name === r_currentTab
      ? 'currentTab'
      : r_selectedItem === name
      ? 'selected'
      : ''
  }`;

  function generateUniqueId() {
    return uuidv4();
  }

  const createTab = async () => {
    // `.lmcc` files open in the question reader instead of the text editor.
    if (isLmccFile) {
      let source = null;
      try {
        source = await readQuestionSource(path);
      } catch (error) {
        source = null;
      }
      const next = source?.ok
        ? ensureLmccTab(r_tabTable, source)
        : ensureLmccTab(r_tabTable, {
            filePath: path,
            content: '',
            root: null,
            loadError: source?.message || '题目文件读取失败。',
          });
      set_r_tabTable(next.tabs);
      set_r_currentTab(next.title);
      return;
    }

    const tebCheck = r_tabTable.findIndex((tab) => tab.title === name);

    const readDirectory = async (path) => {
      try {
        const result = await system.readFileSync(path);
        const decoder = new TextDecoder('utf-8');
        const codeData = decoder.decode(result);
        return codeData;
      } catch (error) {
        console.error('Error reading directory:', error);
        return ''; // 에러 발생 시 빈 문자열 반환
      }
    };

    if (tebCheck < 0) {
      const content = await readDirectory(path);
      const uniqueId = generateUniqueId();
      const newTable = [
        ...r_tabTable,
        {
          id: `${uniqueId}`,
          title: name,
          filePath: path,
          content: content,
          isSaved:true,
          modelUri: `inmemory://model/${uniqueId}`,
        },
      ];

      set_r_tabTable(newTable);
    }
    set_r_currentTab(name);
  };

  const FileIcon = isLmccFile
    ? MenuBookRoundedIcon
    : InsertDriveFileRoundedIcon;

  return (
    <div
      onDoubleClick={() => {
        createTab();
      }}
      onClick={() => onSelect(name)}
    >
      <span className={className}>
        <span className="file-icon">
          <FileIcon sx={{ fontSize: 15 }} />
        </span>
        <span className="file-label">{name}</span>
      </span>
    </div>
  );
};

export default File;
