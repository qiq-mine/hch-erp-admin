import { BankOutlined, DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, type MenuProps } from 'antd';
import { useMemo, useState } from 'react';

export type OrganizationKey = 'sales-company' | 'manufacturing-company';

export const ORGANIZATION_STORAGE_KEY = 'hch-erp:active-organization';

export const ORGANIZATIONS: Record<OrganizationKey, { id: string; label: string }> = {
  'sales-company': { id: 'ORG-01', label: 'hch-销售公司' },
  'manufacturing-company': { id: 'ORG-02', label: 'hch-制造公司' },
};

const ORGANIZATION_KEYS = Object.keys(ORGANIZATIONS) as OrganizationKey[];

function readOrganization(): OrganizationKey {
  if (typeof window === 'undefined') return 'sales-company';
  try {
    const stored = window.localStorage.getItem(ORGANIZATION_STORAGE_KEY);
    return ORGANIZATION_KEYS.includes(stored as OrganizationKey)
      ? stored as OrganizationKey
      : 'sales-company';
  } catch {
    return 'sales-company';
  }
}

export interface OrganizationSwitcherProps {
  compact?: boolean;
}

export function OrganizationSwitcher({ compact }: OrganizationSwitcherProps) {
  const [activeOrganization, setActiveOrganization] = useState<OrganizationKey>(readOrganization);
  const items = useMemo<MenuProps['items']>(() => ORGANIZATION_KEYS.map((key) => ({
    disabled: key === activeOrganization,
    key,
    label: ORGANIZATIONS[key].label,
  })), [activeOrganization]);
  const label = ORGANIZATIONS[activeOrganization].label;

  const switchOrganization: MenuProps['onClick'] = ({ key }) => {
    const organization = key as OrganizationKey;
    setActiveOrganization(organization);
    try {
      window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, organization);
    } catch {
      // The selection still applies for the current session when storage is unavailable.
    }
  };

  return (
    <Dropdown menu={{ items, onClick: switchOrganization }} trigger={['click']}>
      <Button
        aria-label={`当前组织：${label}`}
        title={`当前组织：${label}`}
        type="text"
      >
        {compact
          ? <BankOutlined />
          : <><BankOutlined /> {label} <DownOutlined /></>}
      </Button>
    </Dropdown>
  );
}
