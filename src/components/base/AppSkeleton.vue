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
 * 四种预设，覆盖全站主要加载场景：
 *   list    列表页（我发起的/我参与的/搜索/评论/投票记录/汇总）→ 若干整宽卡片行
 *   detail  详情页（投票详情/问卷填写/编辑回答）→ 徽标行 + 大标题 + 段落 + 选项块
 *   stats   数据页（投票数据/问卷数据）→ 大卡 + 三格 KPI + 一张趋势卡
 *   cards   首页（待我投票 + 我发起的）→ 两张高卡 + 两条窄行
 */
withDefaults(defineProps<{ type?: 'list' | 'detail' | 'stats' | 'cards' }>(), {
  type: 'list'
})
</script>

<template>
  <view class="sk" :class="`sk--${type}`">
    <!-- list -->
    <template v-if="type === 'list'">
      <view v-for="i in 4" :key="i" class="sk__row">
        <view class="sk__line sk__line--title" />
        <view class="sk__line sk__line--sub" />
        <view class="sk__line sk__line--meta" />
      </view>
    </template>

    <!-- detail -->
    <template v-else-if="type === 'detail'">
      <view class="sk__chips">
        <view class="sk__chip" />
        <view class="sk__chip" />
        <view class="sk__chip" />
      </view>
      <view class="sk__line sk__line--h1" />
      <view class="sk__line sk__line--h1 sk__line--short" />
      <view class="sk__line sk__line--sub" />
      <view class="sk__line sk__line--sub sk__line--short" />
      <view v-for="i in 3" :key="i" class="sk__opt">
        <view class="sk__mark" />
        <view class="sk__opt-text">
          <view class="sk__line sk__line--title" />
          <view class="sk__line sk__line--sub" />
        </view>
      </view>
    </template>

    <!-- stats -->
    <template v-else-if="type === 'stats'">
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

    <!-- cards（首页） -->
    <template v-else>
      <view v-for="i in 2" :key="`card-${i}`" class="sk__card sk__card--tall">
        <view class="sk__line sk__line--tiny" />
        <view class="sk__line sk__line--title" />
        <view class="sk__line sk__line--sub" />
        <view class="sk__line sk__line--meta" />
      </view>
      <view v-for="i in 2" :key="`row-${i}`" class="sk__row">
        <view class="sk__line sk__line--title" />
        <view class="sk__line sk__line--sub" />
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
}

/* ---------- 容器：白底 + 描边，和真实卡片一致 ---------- */
.sk__row,
.sk__opt,
.sk__hero,
.sk__kpi,
.sk__card {
  background: $surface;
  border: 1px solid $line;
}

/* ---------- 内部灰块：只给线条、圆点、图表柱 ---------- */
.sk__line,
.sk__chip,
.sk__pill,
.sk__mark,
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
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.75), transparent);
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

/* 列表行：白卡骨架，标题 + 副行 + 元信息 */
.sk__row {
  border-radius: 14px;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.sk__line {
  border-radius: 5px;

  &--tiny {
    height: 9px;
    width: 34%;
  }

  &--title {
    height: 14px;
    width: 62%;
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
  }

  &--stat {
    height: 24px;
    width: 42%;
    border-radius: 7px;
  }

  &--num {
    height: 18px;
    width: 38%;
    border-radius: 6px;
  }

  &--short {
    width: 56%;
  }
}

/* 详情页：徽标行 */
.sk__chips {
  display: flex;
  gap: 6px;
}

.sk__chip {
  width: 56px;
  height: 24px;
  border-radius: 6px;
}

/* 详情页：选项行 —— 白卡 + 左侧圆点 + 两行文字 */
.sk__opt {
  min-height: 64px;
  padding: 14px;
  border-radius: 14px;
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

/* 数据页：大卡 */
.sk__hero {
  padding: 18px;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk__hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sk__pill {
  width: 64px;
  height: 22px;
  border-radius: 8px;
}

.sk__bar {
  height: 8px;
  border-radius: 4px;
}

/* 数据页：三格 KPI */
.sk__kpis {
  display: flex;
  gap: 10px;
}

.sk__kpi {
  flex: 1;
  padding: 13px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 数据页：趋势卡 —— 用一排高低柱代替一整块灰 */
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

/* 首页：两张高卡 —— 四行占位按卡片的上/中/下分布，别全挤在顶部 */
.sk__card--tall {
  min-height: 150px;
  border-radius: 16px;
  gap: 10px;
  justify-content: space-between;
}

/* 系统开了「减弱动态效果」就不扫光，只留静态占位 */
@media (prefers-reduced-motion: reduce) {
  .sk__line::after,
  .sk__chip::after,
  .sk__pill::after,
  .sk__mark::after,
  .sk__bar::after {
    animation: none;
  }
}
</style>
