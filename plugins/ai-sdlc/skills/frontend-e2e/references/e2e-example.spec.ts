// e2e/smoke.spec.ts — frontend-e2e 技能示例：冒烟范型
//
// 冒烟套件是测试门禁的底线（项目没有任何 E2E 时先补这一份）：
// 首页可渲染 + 核心路由可达 + 无全局错误。选择器与断言方式是规范示范
// （技能 §4：data-testid 优先、web-first 断言、零时间等待）。
//
import { test, expect } from '@playwright/test';

test('首页可渲染且核心内容可见', async ({ page }) => {
  await page.goto('/');

  // 优先对页面根容器断言——比断言 <body> 更聚焦，比断言内部结构更抗重构
  await expect(page.getByTestId('app-root')).toBeVisible();

  // 品牌区：可访问性名称断言（角色 + 名称），语义稳定
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toBeVisible();
});

test('核心路由可达（无白屏/无 404 崩溃）', async ({ page }) => {
  // 收集页面级错误：路由可达 ≠ 只是 URL 变了，控制台无未捕获异常才算数
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // [TODO] 换成项目的 2-3 个核心路由
  for (const path of ['/login', '/dashboard']) {
    await page.goto(path);
    await expect(page.getByTestId('app-root')).toBeVisible();
  }

  expect(pageErrors, `路由加载出现未捕获异常: ${pageErrors.join(' | ')}`).toEqual([]);
});

// e2e/checkout.spec.ts — 工作流范型（放独立文件，按功能域拆分）
//
// 工作流用例覆盖「用户行为 → 预期」的完整链路，与 plan.md 的功能点一一对应。
// 登录态用例演示 storageState 之外的轻量隔离法：每用例独立注册/登录。
//
// import { test, expect } from '@playwright/test';
//
// test('提交表单后跳转到结果页', async ({ page }) => {
//   await page.goto('/checkout');
//
//   // 输入：label 关联断言（可访问性契约，不碰 class）
//   await page.getByLabel('收货地址').fill('杭州市西湖区');
//   await page.getByTestId('checkout-submit').click();
//
//   // 预期：URL 与结果页内容双断言——单断言 URL 可能是软跳转假成功
//   await expect(page).toHaveURL(/\/checkout\/success/);
//   await expect(page.getByTestId('order-confirmed')).toContainText('下单成功');
// });
//
// // 视觉闭环（spec.md 带 mock 时，技能 §7）
// test('结算页与 spec mock 视觉一致', async ({ page }) => {
//   await page.goto('/checkout');
//   // mask 遮蔽时间戳/动态区块等噪声源；阈值 1% 容忍亚像素级渲染差异
//   await expect(page).toHaveScreenshot('checkout-page.png', {
//     maxDiffPixelRatio: 0.01,
//     mask: [page.getByTestId('server-time')],
//   });
// });
