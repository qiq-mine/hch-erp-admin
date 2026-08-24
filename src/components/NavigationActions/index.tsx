import {
  InfoCircleOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import { AutoComplete, Button, Grid, Input, Modal, Space, Tooltip, Typography } from 'antd';
import { createStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { AppInitialState } from '@/app';
import { useAppTheme } from '@/components/AppThemeProvider';
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher';
import { RoleSwitcher } from '@/components/RoleSwitcher';
import { PAGE_CATALOG } from '@/config/pageCatalog';
import { canAccess } from '@/config/roles';

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    width: 100%;
    gap: ${token.marginSM}px;
  `,
  headerContext: css`
    min-width: 0;
    overflow: hidden;

    @media (max-width: 767px) {
      display: none;
    }
  `,
  headerLeading: css`
    display: flex;
    align-items: center;
    min-width: 0;
    gap: ${token.marginSM}px;
  `,
  actions: css`
    flex: none;
  `,
  option: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.marginSM}px;
    width: 100%;
  `,
  optionPath: css`
    flex: none;
    font-size: ${token.fontSizeSM}px;
  `,
  searchHint: css`
    display: block;
    margin-top: ${token.marginSM}px;
  `,
}));

export interface NavigationSearchItem {
  path: string;
  title: string;
}

const FIXED_SEARCH_ITEMS: readonly NavigationSearchItem[] = [
  { path: '/about', title: '系统介绍' },
  { path: '/account/profile', title: '个人中心' },
];

export function buildNavigationSearchItems(
  initialState?: AppInitialState,
): NavigationSearchItem[] {
  const role = initialState?.activeRole;
  const policy = initialState?.currentPolicy;
  const policyReady = Boolean(
    role && policy && initialState?.currentPrincipal && !initialState.initializationError,
  );
  if (!role || !policy || !policyReady) return [...FIXED_SEARCH_ITEMS];

  const overrides = { [role]: policy };
  const permittedPages = PAGE_CATALOG.filter((page) =>
    canAccess(role, page.domain, 'read', overrides) &&
    (page.path !== '/security/permissions' ||
      canAccess(role, 'security', 'permission-change', overrides)),
  ).map(({ path, title }) => ({ path, title }));

  return [...FIXED_SEARCH_ITEMS, ...permittedPages];
}

interface InitialStateModel {
  initialState?: AppInitialState;
}

export function NavigationActions() {
  const { styles } = useStyles();
  const model = useModel('@@initialState') as InitialStateModel;
  const { mode, toggle } = useAppTheme();
  const screens = Grid.useBreakpoint();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const items = useMemo(
    () => buildNavigationSearchItems(model.initialState),
    [model.initialState],
  );
  const options = useMemo(() => items.map((item) => ({
    label: (
      <span className={styles.option}>
        <span>{item.title}</span>
        <Typography.Text className={styles.optionPath} type="secondary">
          {item.path}
        </Typography.Text>
      </span>
    ),
    searchText: `${item.title} ${item.path}`,
    value: item.path,
  })), [items, styles.option, styles.optionPath]);

  const navigate = (path: string) => {
    setSearchOpen(false);
    setSearchValue('');
    history.push(path);
  };

  return (
    <>
      <Space className={styles.actions} size={2}>
        <Tooltip title="全局搜索">
          <Button
            aria-label="全局搜索"
            icon={<SearchOutlined />}
            onClick={() => setSearchOpen(true)}
            type="text"
          />
        </Tooltip>
        <Tooltip title="系统介绍">
          <Button
            aria-label="系统介绍"
            icon={<InfoCircleOutlined />}
            onClick={() => navigate('/about')}
            type="text"
          />
        </Tooltip>
        <Tooltip title={mode === 'dark' ? '切换为明亮模式' : '切换为黑暗模式'}>
          <Button
            aria-label={mode === 'dark' ? '切换为明亮模式' : '切换为黑暗模式'}
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
            type="text"
          />
        </Tooltip>
        <RoleSwitcher compact={!screens.lg} />
        <Tooltip title="个人中心">
          <Button
            aria-label="个人中心"
            icon={<UserOutlined />}
            onClick={() => navigate('/account/profile')}
            type="text"
          />
        </Tooltip>
      </Space>
      <Modal
        cancelText="关闭"
        footer={null}
        onCancel={() => {
          setSearchOpen(false);
          setSearchValue('');
        }}
        open={searchOpen}
        title="全局功能搜索"
        width={560}
      >
        <AutoComplete
          autoFocus
          filterOption={(inputValue, option) =>
            String(option?.searchText ?? '').toLowerCase().includes(inputValue.toLowerCase())}
          onChange={setSearchValue}
          onSelect={(path) => navigate(path)}
          options={options}
          style={{ width: '100%' }}
          value={searchValue}
        >
          <Input
            aria-label="搜索页面或业务功能"
            placeholder="输入页面名称或路径，例如：销售订单"
            prefix={<SearchOutlined />}
          />
        </AutoComplete>
        <Typography.Text className={styles.searchHint} type="secondary">
          搜索结果已按当前角色视角和动态权限过滤。
        </Typography.Text>
      </Modal>
    </>
  );
}

export function NavigationHeader({ defaultDom }: { defaultDom: ReactNode }) {
  const { styles } = useStyles();
  const screens = Grid.useBreakpoint();
  return (
    <div className={styles.header}>
      <div className={styles.headerLeading}>
        <div className={styles.headerContext}>{defaultDom}</div>
        <OrganizationSwitcher compact={!screens.lg} />
      </div>
      <NavigationActions />
    </div>
  );
}
