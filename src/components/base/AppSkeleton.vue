<script setup lang="ts">
/**
 * 骨架屏 —— 替代「转圈 + 正在加载」的通用加载态。
 *
 * 加载时用户真正需要的是一个「内容即将出现的占位」，而不是一个孤零零的 spinner。
 *
 * 视觉规则（真机调过）：
 *   容器（列表行 / 选项 / KPI / 卡片）用白底 + $line 描边，和真实卡片一致；
 *   只有内部的线条、圆点、图表柱用浅灰填充。
 *   早先版本把容器也铺成浅灰、内部线条用同一个灰，真机上就是一整块「灰砖」，
 *   线条完全看不见，显得又脏又重。容器留白、内容灰，才像「内容还没加载出来」。
 *
 * 每个预设都照着对应的真实组件搭，尺寸、间距、块的个数都对齐 ——
 * 骨架的意义是「数据到了之后画面不跳」，随手画几根线是做不到这一点的：
 *   home    首页 → 待我投票卡片 + 「我发起的」区块头 + 单列行（对应 PendingCard / mine-row）
 *   cards   待我投票列表 → 整屏 PendingCard
 *   list    投票列表（我发起的/我参与的/搜索/汇总）→ 状态胶囊 + 类型标识 + 标题 + 指标（对应 PollRow）
 *   people  讨论区 → 分段控件 + 头像 + 昵称 + 正文
 *   records 投票记录 → 上下文卡 + 一张白卡里的头像行
 *   detail  详情页 → 徽标行 + 大标题 + 作者行 + 选项块（对应详情页头部 + OptionBar）
 *   stats   数据页 → 大卡 + 三格 KPI + 一张趋势卡
 *
 * flush：放在已经有页面边距（padding: … $gutter …）的容器里时打开，
 * 否则左右会再缩进一圈，比真实内容窄。
 */
withDefaults(
  defineProps<{
    type?: 'home' | 'cards' | 'list' | 'people' | 'records' | 'detail' | 'stats'
    /** 外层容器已经给了页面边距，骨架自己不再加 */
    flush?: boolean
  }>(),
  { type: 'list', flush: false }
)
</script>

<template>
  <view class="sk" :class="[`sk--${type}`, { 'sk--flush': flush }]">
    <!-- home：首页两段内容（第一段的区块头由页面自己渲染） -->
    <template v-if="type === 'home'">
      <view v-for="i in 2" :key="`card-${i}`" class="sk__pending">
        <view class="sk__top">
          <view class="sk__badge" />
          <view class="sk__line sk__line--action" />
        </view>
        <view class="sk__line sk__line--lg" />
        <view class="sk__inviter">
          <view class="sk__dot" />
          <view class="sk__line sk__line--sub" />
        </view>
        <view class="sk__foot">
          <view class="sk__line sk__line--tiny" />
          <view class="sk__btn" />
        </view>
      </view>

      <view class="sk__sec-head">
        <view class="sk__line sk__line--sec" />
        <view class="sk__line sk__line--action" />
      </view>

      <view v-for="i in 2" :key="`mine-${i}`" class="sk__mine">
        <view class="sk__line sk__line--title" />
        <view class="sk__foot">
          <view class="sk__line sk__line--meta" />
          <view class="sk__line sk__line--time" />
        </view>
      </view>
    </template>

    <!-- cards：整屏 PendingCard -->
    <template v-else-if="type === 'cards'">
      <view v-for="i in 3" :key="i" class="sk__pending">
        <view class="sk__top">
          <view class="sk__badge" />
          <view class="sk__line sk__line--action" />
        </view>
        <view class="sk__line sk__line--lg" />
        <view class="sk__inviter">
          <view class="sk__dot" />
          <view class="sk__line sk__line--sub" />
        </view>
        <view class="sk__foot">
          <view class="sk__line sk__line--tiny" />
          <view class="sk__btn" />
        </view>
      </view>
    </template>

    <!-- list：PollRow 的形状 -->
    <template v-else-if="type === 'list'">
      <view v-for="i in 4" :key="i" class="sk__row">
        <view class="sk__top">
          <view class="sk__pill" />
          <view class="sk__badge sk__badge--sm" />
          <view class="sk__spacer" />
          <view class="sk__line sk__line--time" />
        </view>
        <view class="sk__line sk__line--title" />
        <view class="sk__foot">
          <view class="sk__line sk__line--meta" />
          <view class="sk__icon" />
        </view>
      </view>
    </template>

    <!-- people：讨论区。分段控件 + 头像 + 昵称 + 正文 + 时间，行间一条分割线 -->
    <template v-else-if="type === 'people'">
      <view class="sk__tabs">
        <view v-for="i in 3" :key="i" class="sk__tab" :class="{ 'sk__tab--on': i === 1 }">
          <view class="sk__line sk__line--tabtext" />
        </view>
      </view>

      <view v-for="i in 4" :key="i" class="sk__person">
        <view class="sk__avatar" />
        <view class="sk__person-text">
          <view class="sk__line sk__line--name" />
          <view class="sk__line sk__line--sub" />
          <view class="sk__line sk__line--tiny" />
        </view>
      </view>
    </template>

    <!-- records：投票记录。上方上下文卡 + 一整张白卡里的头像行 -->
    <template v-else-if="type === 'records'">
      <view class="sk__hero">
        <view class="sk__hero-top">
          <view class="sk__badge" />
          <view class="sk__badge sk__badge--sm" />
        </view>
        <view class="sk__line sk__line--lg" />
        <view class="sk__line sk__line--stat" />
      </view>

      <view class="sk__records">
        <view v-for="i in 5" :key="i" class="sk__rec">
          <view class="sk__avatar" />
          <view class="sk__rec-text">
            <view class="sk__line sk__line--name" />
            <view class="sk__line sk__line--tiny" />
          </view>
          <view class="sk__badge sk__badge--sm" />
        </view>
      </view>
    </template>

    <!-- detail：徽标行 + 大标题 + 作者行 + 选项块 -->
    <template v-else-if="type === 'detail'">
      <view class="sk__chips">
        <view class="sk__pill" />
        <view class="sk__badge sk__badge--sm" />
      </view>

      <view class="sk__line sk__line--h1" />
      <view class="sk__line sk__line--h1 sk__line--short" />

      <view class="sk__author">
        <view class="sk__avatar sk__avatar--sm" />
        <view class="sk__person-text">
          <view class="sk__line sk__line--name" />
          <view class="sk__line sk__line--tiny" />
        </view>
      </view>

      <view class="sk__line sk__line--label" />

      <view v-for="i in 3" :key="i" class="sk__opt">
        <view class="sk__mark" />
        <view class="sk__opt-text">
          <view class="sk__line sk__line--title" />
          <view class="sk__line sk__line--sub" />
        </view>
      </view>
    </template>

    <!-- stats：大卡 + 三格 KPI + 趋势卡 -->
    <template v-else>
      <view class="sk__hero">
        <view class="sk__hero-top">
          <view class="sk__pill" />
          <view class="sk__line sk__line--tiny" />
        </view>
        <view class="sk__line sk__line--title" />
        <view class="sk__line sk__line--stat" />
        <view class="sk__bar" />
      </view>
      <view class="sk__kpis">
        <view v-for="i in 3" :key="i" class="sk__kpi">
          <view class="sk__line sk__line--tiny" />
          <view class="sk__line sk__line--num" />
        </view>
      </view>
      <view class="sk__card">
        <view class="sk__line sk__line--title" />
        <view class="sk__chart">
          <view
            v-for="(h, i) in [42, 64, 36, 78, 54, 88]"
            :key="i"
            class="sk__chart-bar"
            :style="{ height: `${h}px` }"
          />
        </view>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'AppSkeleton' }
</script>

<style lang="scss" scoped>
.sk {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px $gutter 20px;

  /* 外层容器已经有页面边距时不再加，否则左右各多缩 20，比真实内容窄一圈 */
  &--flush {
    padding: 0;
  }
}

/* ---------- 容器：白底 + 描边，和真实卡片一致 ---------- */
.sk__row,
.sk__opt,
.sk__pending,
.sk__mine,
.sk__hero,
.sk__kpi,
.sk__card {
  background: $surface;
  border: 1px solid $line;
}

/* ---------- 内部灰块：只给线条、圆点、图表柱 ---------- */
.sk__line,
.sk__pill,
.sk__badge,
.sk__mark,
.sk__dot,
.sk__avatar,
.sk__btn,
.sk__icon,
.sk__bar {
  position: relative;
  overflow: hidden;
  background: $line;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 55%;
    /*
     * 两端必须写 rgba(255,255,255,0)，不能写 transparent。
     *
     * transparent 等价于 rgba(0,0,0,0)：开发者工具（Chromium）按预乘 alpha 插值，
     * 看起来是「白 → 透明」；但真机的 iOS/Android WebView（尤其中低端机和较老的
     * WebKit）按非预乘插值，中间的 RGB 会被拉向黑色，扫光就变成一条发黑的带子。
     * 显式写白色透明，两端才是「白色淡出」，和设计稿一致。
     */
    background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.75) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    transform: translateX(-100%);
    animation: sk-shimmer $dur-shimmer $ease-both infinite;
  }
}

/* 扫光只用 opacity/transform，不触发重排；时长走全局 token 保持一致 */
@keyframes sk-shimmer {
  to {
    transform: translateX(220%);
  }
}

/* ---------- 线条：宽度按真实文字的长度给 ---------- */
.sk__line {
  border-radius: 5px;

  &--tiny {
    height: 9px;
    width: 34%;
  }

  &--time {
    height: 10px;
    width: 46px;
  }

  &--title {
    height: 14px;
    width: 62%;
  }

  &--lg {
    height: 16px;
    width: 72%;
    border-radius: 6px;
  }

  &--name {
    height: 11px;
    width: 34%;
  }

  &--tabtext {
    width: 30px;
    height: 10px;
  }

  &--sub {
    height: 10px;
    width: 44%;
  }

  &--meta {
    height: 10px;
    width: 28%;
  }

  &--h1 {
    height: 22px;
    width: 90%;
    border-radius: 6px;
  }

  &--label {
    height: 13px;
    width: 26%;
  }

  &--sec {
    height: 15px;
    width: 34%;
    border-radius: 6px;
  }

  /* 区块头右侧的「全部 3 个」 */
  &--action {
    width: 48px;
    height: 10px;
  }

  &--stat {
    height: 24px;
    width: 42%;
    border-radius: 7px;
  }

  &--num {
    height: 18px;
    width: 38%;
    border-radius: $r-xs;
  }

  &--short {
    width: 56%;
  }
}

/* ---------- 通用小块 ---------- */
.sk__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}

.sk__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sk__spacer {
  flex: 1;
}

/* 状态胶囊 20 高（和 StatusPill 一致） */
.sk__pill {
  width: 58px;
  height: 20px;
  border-radius: $r-xs;
  flex-shrink: 0;
}

/* 类型标识：和 StatusPill 同高，sm 一档给列表行 */
.sk__badge {
  width: 44px;
  height: 20px;
  border-radius: $r-xs;
  flex-shrink: 0;

  &--sm {
    width: 38px;
    height: 20px;
  }
}

/* 列表行尾部那个 › / ··· */
.sk__icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ---------- home / cards：PendingCard 的形状 ---------- */
.sk__pending {
  padding: 16px;
  border-radius: $r-button;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.sk__inviter {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sk__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 「去投票」按钮：和真实按钮同尺寸，但不涂成主色，免得骨架比内容还抢眼 */
.sk__btn {
  width: 64px;
  height: 30px;
  border-radius: $r-sm;
  flex-shrink: 0;
}

/* home：「我发起的」区块头 + 单列行 */
.sk__sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
}

.sk__mine {
  padding: 14px;
  border-radius: $r-input;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---------- list：PollRow 的形状 ---------- */
.sk__row {
  border-radius: $r-input;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* ---------- people：讨论区 ---------- */
.sk--people {
  gap: 12px;
}

/* 分段控件：$subtle 轨道 + 白色选中块，和真实的 tabs 一致 */
.sk__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: $r-md;
  background: $subtle;
}

.sk__tab {
  flex: 1;
  height: 30px;
  border-radius: $r-chip;
  display: flex;
  align-items: center;
  justify-content: center;

  &--on {
    background: $surface;
  }
}

/* 评论行：头像 34 + 昵称 / 正文 / 时间，行与行之间一条分割线 */
.sk__person {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  & + & {
    border-top: 1px solid $line;
    padding-top: 12px;
  }
}

.sk__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex-shrink: 0;

  &--sm {
    width: 26px;
    height: 26px;
  }
}

.sk__person-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 3px;
}

/* ---------- records：投票记录 ---------- */
.sk__records {
  background: $surface;
  border: 1px solid $line;
  border-radius: $r-input;
  overflow: hidden;
}

.sk__rec {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;

  & + & {
    border-top: 1px solid $line;
  }
}

.sk__rec-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ---------- detail ---------- */
.sk__chips {
  display: flex;
  gap: 6px;
}

.sk__author {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 选项行：白卡 + 左侧圆点 + 两行文字 */
.sk__opt {
  min-height: 64px;
  padding: 14px;
  border-radius: $r-input;
  display: flex;
  align-items: center;
  gap: 12px;
}

.sk__mark {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk__opt-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* ---------- stats ---------- */
.sk__hero {
  padding: 18px;
  border-radius: $r-sheet;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk__hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sk__bar {
  height: 8px;
  border-radius: 4px;
}

.sk__kpis {
  display: flex;
  gap: 10px;
}

.sk__kpi {
  flex: 1;
  padding: 13px;
  border-radius: $r-input;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk__card {
  padding: 16px;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.sk__chart {
  height: 96px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.sk__chart-bar {
  flex: 1;
  border-radius: 6px 6px 2px 2px;
  background: $subtle;
}

/* 系统开了「减弱动态效果」就不扫光，只留静态占位 */
@media (prefers-reduced-motion: reduce) {
  .sk__line::after,
  .sk__pill::after,
  .sk__badge::after,
  .sk__mark::after,
  .sk__dot::after,
  .sk__avatar::after,
  .sk__btn::after,
  .sk__icon::after,
  .sk__bar::after {
    animation: none;
  }
}
</style>
