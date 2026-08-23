import { PageContainer } from '@ant-design/pro-components';
import { PRODUCT_NAME } from '@/config/product';

export default function BootstrapPage() {
  return (
    <PageContainer title={PRODUCT_NAME}>
      <p>当前处于 Mock 数据引导模式。</p>
    </PageContainer>
  );
}
