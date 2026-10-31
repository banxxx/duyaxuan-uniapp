<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { resolveFileUrl } from '@/utils/api-base'
import { percent } from '@/utils/format'

/**
 * 选项条 —— 05/06 待投票、07/08 待投票但结果可见、09-12 已投票、21 结果页 共用
 *
 * 设计稿里是同一张卡片的四种形态，用 mode 区分：
 *
 *   vote         05/06  圆点 + 标题 + 说明；圆角 14、内边距 14、元素间距 12
 *   vote-result  07/08  同 vote，行尾多一列「41 票 · 46%」（宽 76、右对齐）
 *   result       09/11  竖向：勾选图标 + 标题 + 说明 + 行尾票数，下面 6 高进度条
 *   locked       10/12  紧凑行：circle / circle-check 图标 + 标题 + 说明，不显示票数
 *
 * 选中态统一是 $accent-soft 底 + $accent 描边 + 标题加粗，
 * 右上角再贴一枚「已选择」标签。
 */
const props = withDefaults(
  defineProps<{
    title: string
    desc?: string
    /** 图文投票的配图，第一张当封面；最多 3 张 */
    images?: string[]
    votes?: number
    total?: number
    /** 单选还是多选，决定选中框形状 */
    multiple?: boolean
    selected?: boolean
    mode?: 'vote' | 'vote-result' | 'result' | 'locked'
    /** 不可点（已截止、已投票、无权限） */
    disabled?: boolean
  }>(),
  {
    multiple: false,
    selected: false,
    mode: 'vote',
    disabled: false
  }
)

const emit = defineEmits<{ (e: 'select'): void }>()

const pct = computed(() => percent(props.votes ?? 0, props.total ?? 0))

/** 图文投票：有封面才走带图布局，纯文字选项和以前完全一样 */
const cover = computed(() => props.images?.[0] ?? '')
const extraImages = computed(() => Math.max((props.images?.length ?? 0) - 1, 0))

/**
 * 点缩略图看大图。
 *
 * 用 stop 挡住冒泡 —— 否则在投票态点图会顺手把这一项选中。
 * 单选和多选都允许边看边选，所以不锁 disabled。
 */
function preview() {
  const urls = (props.images ?? []).map(resolveFileUrl)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[0] })
}

/** 票数只在两种「看结果」的形态里出现 */
const showVotes = computed(() => props.mode === 'vote-result' || props.mode === 'result')

const readonly = computed(() => props.mode === 'result' || props.mode === 'locked' || props.disabled)

/**
 * 有说明就显示，四种形态都一样。
 *
 * 结果态以前只留标题，是为了把卡片压到 66 高、让一列进度条对齐；
 * 但投完票再回来，光看标题想不起每个选项是什么，图文投票尤其明显 ——
 * 现在保留说明，高度交给内容撑（见 .option--result / --locked）。
 */
const showDesc = computed(() => !!props.desc)

/**
 * 折叠 / 展开
 *
 * 卡片高度固定，标题和说明各占一行，超长就省略；量到「装不下」时给一个
 * 展开开关，点开就地长高显示全文。这样一屏里所有卡片始终等高，
 * 不会因为某个选项写了三行字把整组撑高。
 */
const expanded = ref(false)
const expandable = ref(false)

/** 折叠时文字区的高度：标题 21 + 间距 2 + 说明 15.4 */
const COLLAPSED_WITH_DESC = 40
/** 结果态只有标题一行：14px × 1.4 = 19.6 */
const COLLAPSED_TITLE_ONLY = 21

const instance = getCurrentInstance()

function toggle() {
  expanded.value = !expanded.value
}

/**
 * 拿不到实际尺寸时的兜底：按字数估。
 * 宁可多显示一个「展开」（点开发现没变化），也不能该显示时没有。
 */
function estimateOverflow(): boolean {
  const width = (s?: string) =>
    Array.from(s ?? '').reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : 0.6), 0)
  // 行尾还有票数一列时文字区更窄，一行能放的字更少
  const narrow = props.mode === 'vote-result' || props.mode === 'result'
  return (
    width(props.title) > (narrow ? 12 : 18) ||
    (showDesc.value && width(props.desc) > (narrow ? 16 : 24))
  )
}

/**
 * 量真实高度
 *
 * 页面上那两行是单行省略（盒子高度被裁剪），量它们没有意义；
 * 所以模板里放了一份「同样宽度、不裁剪、不可见」的副本，只读它的高度。
 *
 * 先把估算值当作初值：测量要等一次渲染，这一帧里长文字也得有个展开入口；
 * 量到真值后再用真值覆盖。测量失败（老基础库 / H5 结构差异）就停在估算上。
 */
function measure() {
  expandable.value = estimateOverflow()
  nextTick(() => {
    try {
      uni
        .createSelectorQuery()
        .in(instance?.proxy as never)
        .select('.option__measure')
        .boundingClientRect((rect) => {
          const height = (rect as UniApp.NodeInfo | null)?.height ?? 0
          if (!height) return
          expandable.value = height > (showDesc.value ? COLLAPSED_WITH_DESC : COLLAPSED_TITLE_ONLY)
        })
        .exec()
    } catch {
      // 拿不到尺寸就保留估算值
    }
  })
}

onMounted(measure)

// 投完票从 vote 切到 result、或者状态变了，展开状态不该跟着沿用
watch(
  () => props.mode,
  () => {
    expanded.value = false
  }
)

// 分开监听：写成返回数组的 getter 会在每次重渲染时都触发（数组是新引用）。
// selected 也要听 —— 选中后右边多出「已选择」一列，标题可用宽度变窄了，得重量一次
watch([() => props.title, () => props.desc, () => props.mode, () => props.selected], measure)
</script>

<template>
  <view
    class="option"
    :class="[
      `option--${mode}`,
      { 'option--selected': selected, 'option--expanded': expanded, 'option--with-image': !!cover }
    ]"
    :hover-class="readonly ? 'none' : 'option--active'"
    @tap="!readonly && emit('select')"
  >
    <!-- 已选择：贴着卡片右上角长出来的一小片，不占行内空间 -->
    <view v-if="selected" class="option__tag">
      <AppIcon name="check" :size="9" color="#FFFFFF" :stroke-width="3" />
      <text class="option__tag-text">已选择</text>
    </view>

    <view class="option__row">
      <view class="option__left">
        <!-- 10/12：结果隐藏，只标出我选的那条；单选圆形、多选方形 -->
        <AppIcon
          v-if="mode === 'locked'"
          :name="selected ? (multiple ? 'square-check' : 'circle-check') : multiple ? 'square' : 'circle'"
          :size="16"
          :color="selected ? '#4F46E5' : '#A1A1AA'"
        />

        <!-- 09/11：结果可见，选中项用勾选图标替掉圆点 -->
        <AppIcon
          v-else-if="mode === 'result' && selected"
          name="circle-check"
          :size="15"
          color="#4F46E5"
          :stroke-width="2"
        />

        <!-- 05-08：待投票，20 圆点 / 圆角方块 -->
        <view
          v-else
          class="option__mark"
          :class="{ 'option__mark--multi': multiple, 'option__mark--on': selected }"
        >
          <AppIcon
            v-if="selected"
            class="option__check anim anim--pop"
            name="check"
            :size="12"
            color="#FFFFFF"
            :stroke-width="3"
          />
        </view>

        <!-- 图文投票：封面缩略图，点开看全部配图 -->
        <view v-if="cover" class="option__thumb" @tap.stop="preview">
          <image class="option__thumb-img" :src="resolveFileUrl(cover)" mode="aspectFill" />
          <view v-if="extraImages" class="option__thumb-count">
            <text class="option__thumb-count-text">+{{ extraImages }}</text>
          </view>
        </view>

        <view class="option__text">
          <text class="option__title" :class="{ 'option__title--clamp': !expanded }">{{ title }}</text>
          <text v-if="showDesc" class="option__desc" :class="{ 'option__desc--clamp': !expanded }">
            {{ desc }}
          </text>

          <!-- 测量副本：同样宽度、不裁剪、不可见，只用来量真实行高 -->
          <view class="option__measure" aria-hidden="true">
            <text class="option__title">{{ title }}</text>
            <text v-if="showDesc" class="option__desc">{{ desc }}</text>
          </view>
        </view>
      </view>

      <text v-if="showVotes" class="option__value">{{ votes ?? 0 }} 票 · {{ pct }}%</text>

      <!-- 文字装不下时才出现；点它只切换展开，不算选中 -->
      <view
        v-if="expandable"
        class="option__toggle"
        hover-class="option__toggle--active"
        @tap.stop="toggle"
      >
        <AppIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="14" color="#A1A1AA" />
      </view>
    </view>

    <view v-if="mode === 'result'" class="option__track">
      <!-- 票数条从左往右长出来，宽度仍是 inline style，动效只做 scaleX -->
      <view class="option__fill anim anim--grow" :style="{ width: `${pct}%` }" />
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'OptionBar' }
</script>

<style lang="scss" scoped>
.option {
  /* 「已选择」标签要贴到卡片角上 */
  position: relative;
  padding: 14px;
  background: $surface;
  border: 1px solid $line;
  border-radius: $r-input;
  /* 选中 / 按下时底色和描边渐变过去，避免勾选瞬间硬切 */
  transition:
    background-color $dur-fast $ease-both,
    border-color $dur-fast $ease-both,
    box-shadow $dur-fast $ease-both;

  &--active {
    background: $subtle;
  }

  /* 05-08：固定高度 —— 标题 + 说明各一行，内容垂直居中。
     高度写死是「等高」的来源，长文字靠单行省略 + 展开解决，不靠撑高卡片。 */
  &--vote,
  &--vote-result {
    height: 70px;
    display: flex;
    align-items: center;
  }

  /*
   * 09/11：竖向，标题 + 说明 + 进度条，行距 8。
   * 高度交给内容撑：有说明时 82（28 + 2 + 19.6 + 2 + 15.4 + 8 + 6），
   * 没说明时只有 64 —— 写死 82 会让没写说明的选项空出一大块。
   */
  &--result {
    height: auto;
    min-height: 66px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }

  /* 10/12：紧凑行，内边距比另外几种小一号；有说明时自己长高 */
  &--locked {
    height: auto;
    min-height: 52px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
  }

  /*
   * 带图：卡片跟着 56 的封面加高，三种形态各给一个最小高度。
   * 用 min-height + height:auto 而不是写死 height —— 图片加载失败时
   * 文字仍然能把卡片撑住，不会塌成一条。
   */
  &--with-image {
    height: auto;
    min-height: 86px;
  }

  &--with-image.option--locked {
    /* 行 56 + 上下内边距 20 + 描边 2 */
    min-height: 76px;
  }

  &--with-image.option--result {
    /* 行 56 + 行距 8 + 进度条 6 + 上下内边距 28 + 描边 2 */
    min-height: 100px;
  }

  /* 展开：这一张由内容撑高，其他卡片仍旧等高 */
  &--expanded {
    height: auto;
    min-height: 52px;
  }

  /* 选中态：设计稿是 2px $accent 描边。
     用 1px border + 1px 内阴影叠成 2px，而不是把 border-width 改成 2 ——
     改 border-width 会让 border-box 的内容区缩 1px，勾选时整块文字轻微抖动。 */
  &--selected {
    background: $accent-soft;
    border-color: $accent;
    box-shadow: inset 0 0 0 1px $accent;
  }

  &__row {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  &__left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  &--result &__left {
    gap: 7px;
  }

  &--locked &__left {
    gap: 10px;
  }

  /* 设计稿：20 的正圆，2px $line 描边，未选中时完全透明底 */
  &__mark {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid $line;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color $dur-fast $ease-both,
      border-color $dur-fast $ease-both,
      transform $dur-fast $ease-both;

    &--multi {
      border-radius: $r-xs;
    }

    &--on {
      border-color: $accent;
      background: $accent;
      /* 圆点轻轻涨一下，勾选有「按下去」的反馈 */
      transform: scale(1.06);
    }
  }

  &__check {
    animation-duration: $dur-fast;
  }

  /*
   * 带图时勾选圈和图之间不用 12 那么空。
   * 一行里要塞下 勾选圈 + 图 + 标题/说明 + 票数 + 展开开关，
   * 宽度很紧，所以图压到 56、间距 8 —— 再大标题就只剩七八个字了。
   */
  &--with-image &__left {
    gap: 8px;
  }

  /* 票数按内容撑开，不再固定 76 宽，给标题腾一点位置 */
  &--with-image &__value {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  /* 封面缩略图：56 的方图，圆角和输入框一致 */
  &__thumb {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: $r-sm;
    overflow: hidden;
    background: $subtle;
    flex-shrink: 0;
  }

  &__thumb-img {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* 「+2」角标：还有几张没显示 */
  &__thumb-count {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 1px 4px;
    border-top-left-radius: $r-xs;
    background: rgba(0, 0, 0, 0.55);
  }

  &__thumb-count-text {
    font-size: 9px;
    line-height: 1.2;
    color: $white;
  }

  &__text {
    /* 测量副本的定位基准 */
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  /* 固定成块级：展开 / 折叠只切换省略样式，
     不切换 inline / block —— 换布局模式会让文字在展开瞬间重排一次 */
  &__title {
    display: block;
    font-size: $fs-15;
    font-weight: 500;
    color: $ink;
    line-height: 1.4;
  }

  /*
   * 「已选择」：贴在卡片右上角的一小片，参考设计里那种「从卡片角上长出来」的标签 ——
   * 右上角沿用卡片自己的圆角，左下角收一个大圆当尾巴，另外两个角只留一点点。
   *
   * $accent 实底 + 白字，和卡片选中的描边同色 —— 标签像是描边在角上鼓出来的一块。
   * 标签贴在描边内侧而不是盖住描边，卡片轮廓才是完整的。
   */
  &__tag {
    position: absolute;
    /* 贴着描边的内侧，让卡片那条描边从标签外面绕过去 —— 卡片轮廓才是完整的 */
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 7px;
    /* 右上角跟卡片内圆角走：$r-input 减去 1px 描边 */
    border-radius: 3px 13px 3px 7px;
    background: $accent;
  }

  &__tag-text {
    font-size: $fs-10;
    font-weight: 600;
    line-height: 1;
    color: $white;
  }

  /*
   * 标签是绝对定位的，会压住这一行的右上角。
   * 07-12 有票数一列，文字本来就让开了；05/06/10/12 没有票数，
   * 标题会一直顶到卡片右边，得给它让出标签的宽度。
   */
  &--selected.option--vote &__text,
  &--selected.option--locked &__text {
    padding-right: 52px;
  }

  /* 测量副本要跟着窄同样多，否则会量出「装得下」，该出展开开关时不出 */
  &--selected.option--vote &__measure,
  &--selected.option--locked &__measure {
    right: 52px;
  }

  /* 折叠态：标题和说明各占一行，超出省略；展开后这两条不生效，自然换行 */
  &__title--clamp,
  &__desc--clamp {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* 测量副本：不占位、不可见，但保留布局，量出来的就是完整文字的高度 */
  &__measure {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    visibility: hidden;
    pointer-events: none;
  }

  /* 展开开关：只占 20 宽，点它不算选中选项。
     常驻一层浅底 —— 光秃秃的箭头在这一行里容易被当成「跳到详情」 */
  &__toggle {
    width: 20px;
    height: 20px;
    margin-left: 2px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $r-sm;
    background: $subtle;
    transition: background-color $dur-fast $ease-both;

    &--active {
      background: $line;
    }
  }

  &--result &__title,
  &--locked &__title {
    font-size: $fs-14;
    font-weight: 400;
  }

  &--selected &__title {
    font-weight: 600;
  }

  &__desc {
    display: block;
    font-size: $fs-11;
    color: $faint;
    line-height: 1.4;
  }

  /* 07：行尾票数宽 76、右对齐；未选中 12/400/$muted，选中 12/600/$accent */
  &__value {
    flex: 0 0 76px;
    text-align: right;
    font-size: $fs-12;
    font-weight: 400;
    color: $muted;
    font-family: $font-num;
    transition: color $dur-fast $ease-both;
  }

  &--result &__value {
    flex: 0 0 auto;
    /* 09/11 已投票：票数无论选中与否都是 600，只有颜色区分（选中 $accent / 未选中 $muted） */
    font-weight: 600;
  }


  &--selected &__value {
    font-weight: 600;
    color: $accent;
  }

  &__track {
    height: 6px;
    border-radius: 3px;
    background: $line;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 3px;
    background: $track-strong;
    /* 进场由 .anim--grow 的 scaleX 负责，这里只管数值变化时的宽度过渡 */
    transition: width $dur-slow $ease-both;
  }

  &--selected &__fill {
    background: $accent;
  }
}
</style>
