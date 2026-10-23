<script setup lang="ts">
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 设置菜单行
 *
 * 43/44/46/48/55 都是同一个结构：图标 + 标题 + 右侧值 + 箭头。
 * 46 的行是两行文字（标题 + 说明），所以 desc 可选。
 * 45 编辑资料那种「标题 + 输入框」不走这里，单独排版。
 *
 * 两种疏密，按设计稿：
 *   默认（43 设置）      → padding [13,15]、标题 14/400
 *   46 账号与安全        → padding [14,16]、标题 14/500（整页只有入口，行更松更显眼）
 *   48 关于我们          → padding [14,16]、标题 14/400，用 roomy 且不带 strong
 */
withDefaults(
  defineProps<{
    title: string
    icon?: string
    /** 第二行说明，如「已绑定 · 林小满」 */
    desc?: string
    /** 右侧值，如「开启」「12.4 MB」 */
    value?: string
    /** 值是否用强调色（如「已绑定」） */
    valueAccent?: boolean
    /** 危险操作（退出登录 / 注销账号） */
    danger?: boolean
    /** 是否显示右箭头，默认 true */
    chevron?: boolean
    /** 行内边距放到 [14,16]（46/48） */
    roomy?: boolean
    /** 标题加粗到 500（46） */
    strong?: boolean
  }>(),
  { chevron: true, danger: false, valueAccent: false, roomy: false, strong: false }
)

const emit = defineEmits<{ (e: 'tap'): void }>()
</script>

<template>
  <view
    class="menu"
    :class="{ 'menu--danger': danger, 'menu--roomy': roomy, 'menu--strong': strong }"
    hover-class="menu--active"
    @tap="emit('tap')"
  >
    <view v-if="icon" class="menu__icon">
      <AppIcon :name="icon" :size="17" :color="danger ? '#DC2626' : '#71717A'" />
    </view>

    <view class="menu__text">
      <text class="menu__title" :class="{ 'menu__title--danger': danger }">{{ title }}</text>
      <text v-if="desc" class="menu__desc">{{ desc }}</text>
    </view>

    <text v-if="value" class="menu__value" :class="{ 'menu__value--accent': valueAccent }">
      {{ value }}
    </text>

    <slot />

    <AppIcon v-if="chevron" name="chevron-right" :size="15" color="#A1A1AA" />
  </view>
</template>

<script lang="ts">
export default { name: 'MenuRow' }
</script>

<style lang="scss" scoped>
.menu {
  padding: 13px 15px;
  display: flex;
  align-items: center;
  gap: 12px;

  &--active {
    background: $subtle;
  }

  /* 46/48：行更高，图标与文字之间仍是 12 */
  &--roomy {
    padding: 14px 16px;
  }

  &--strong &__title {
    font-weight: 500;
  }

  &__icon {
    width: 17px;
    height: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 400;
    color: $ink;

    &--danger {
      color: $danger;
      font-weight: 600;
      text-align: center;
    }
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }

  &__value {
    font-size: 12px;
    color: $faint;
    flex-shrink: 0;

    &--accent {
      color: $success;
    }
  }
}
</style>
