<script setup lang="ts">
/**
 * 骨架屏 —— 替代「转圈 + 正在加载」的通用加载态。
 *
 * 加载时用户真正需要的是一个「内容即将出现的占位」，而不是一个孤零零的 spinner。
 * 骨架块用 $subtle 底 + 一道从左扫到右的高光（shimmer），和设计稿卡片同圆角、同密度。
 *
 * 四种预设，覆盖全站主要加载场景：
 *   list    列表页（我发起的/我参与的/搜索/评论/投票记录/汇总）→ 若干整宽卡片行
 *   detail  详情页（投票详情/问卷填写/编辑回答）→ 徽标行 + 大标题 + 段落 + 选项块
 *   stats   数据页（投票数据/问卷数据）→ 黑卡 + 三格 KPI + 一张大卡
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
      <view class="sk__opt" v-for="i in 3" :key="i" />
    </template>

    <!-- stats -->
    <template v-else-if="type === 'stats'">
      <view class="sk__hero" />
      <view class="sk__kpis">
        <view class="sk__kpi" v-for="i in 3" :key="i" />
      </view>
      <view class="sk__card" />
    </template>

    <!-- cards（首页） -->
    <template v-else>
      <view class="sk__card sk__card--tall" />
      <view class="sk__card sk__card--tall" />
      <view class="sk__row" />
      <view class="sk__row" />
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

/* 骨架块：$subtle 底 + 从左扫到右的高光 */
.sk__line,
.sk__chip,
.sk__opt,
.sk__hero,
.sk__kpi,
.sk__card,
.sk__row {
  position: relative;
  overflow: hidden;
  background: $subtle;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 60%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent);
    transform: translateX(-100%);
    animation: sk-shimmer 1.3s ease-in-out infinite;
  }
}

@keyframes sk-shimmer {
  to {
    transform: translateX(220%);
  }
}

/* 列表行：白卡骨架，标题 + 副行 + 元信息 */
.sk__row {
  border: 1px solid $line;
  border-radius: 14px;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 9px;

  &::after {
    display: none; // 行是容器，靠内部线条扫光
  }
}

.sk__line {
  border-radius: 5px;

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

.sk__opt {
  height: 64px;
  border: 1px solid $line;
  border-radius: 14px;
}

/* 数据页 */
.sk__hero {
  height: 150px;
  border-radius: 20px;
  background: #e4e4e7;
}

.sk__kpis {
  display: flex;
  gap: 10px;
}

.sk__kpi {
  flex: 1;
  height: 66px;
  border: 1px solid $line;
  border-radius: 14px;
}

.sk__card {
  height: 180px;
  border: 1px solid $line;
  border-radius: 18px;

  &--tall {
    height: 150px;
    border-radius: 16px;
  }
}
</style>
