<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { getSafeArea } from '@/utils/platform'

/**
 * 截止时间选择器 —— 设计稿 34（日期）/ 35（时间）
 *
 * 为什么不用 <picker mode="date">：那是系统原生滚轮，颜色、圆角、间距
 * 一个都改不了，和设计稿的日历面板完全不是一回事。这里按设计稿自己画。
 *
 * 34 日期页：分段控件（日期/时间）+ 月份切换 + 周一开头的星期行 +
 *            38 高的日期格子（选中 $accent 底白字）+ 底部时间行 + 确认按钮
 * 35 时间页：同一分段控件 + 日期摘要与「改日期」+ 4 个快捷 chip +
 *            小时/分钟双列滚轮（中间 $accent-soft 选中带）+ 确认按钮
 *
 * 两页共用一个面板，切换分段不重开弹层 —— 设计稿就是这么表达的。
 */

const props = defineProps<{
  visible: boolean
  /** 初始值：时间戳。不传就用「现在 + 3 天 18:00」 */
  modelValue?: number
  /** 最早可选到哪一天（默认今天） */
  min?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', value: number): void
}>()

type Tab = 'date' | 'time'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const QUICK_TIMES = ['09:00', '12:00', '18:00', '21:00']

/** 面板下边距：设计稿 24 + 底部小横条 */
const { safeBottom } = getSafeArea()
const panelPad = computed(() => `${24 + safeBottom}px`)

const tab = ref<Tab>('date')

/* ---------------- 选中值 ---------------- */

function defaultValue(): number {
  const d = new Date(Date.now() + 3 * 86400000)
  d.setHours(18, 0, 0, 0)
  return d.getTime()
}

const picked = ref(props.modelValue ?? defaultValue())

const pickedDate = computed(() => new Date(picked.value))

/* ---------------- 日期网格 ---------------- */

const viewYear = ref(pickedDate.value.getFullYear())
const viewMonth = ref(pickedDate.value.getMonth())

/**
 * 同步外部值。
 *
 * 两条路径都要覆盖：
 *   1. 组件首次挂载时（父级用 v-if 控制，面板每次都是全新实例，
 *      watch 永远等不到一次 false→true 的跳变，必须靠 immediate）；
 *   2. 面板打开期间 modelValue 被外部改写（例如切到别的预设）。
 *
 * 之前只监听 visible 且没有 immediate，所以打开时显示的还是上一次的值，
 * 看起来就像「选了不生效、退出去回来才对」。
 */
watch(
  () => [props.visible, props.modelValue] as const,
  ([visible, value]) => {
    if (!visible) return
    if (value != null) picked.value = value
    tab.value = 'date'
    const d = new Date(picked.value)
    viewYear.value = d.getFullYear()
    viewMonth.value = d.getMonth()
  },
  { immediate: true }
)

const monthLabel = computed(() => `${viewYear.value} 年 ${viewMonth.value + 1} 月`)

/** 周一开头：把 JS 的 0=周日 换算成 0=周一 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

interface DayCell {
  key: string
  /** null 表示这个位置是上/下月的留白 */
  day: number | null
  /** 是否早于最小可选日 */
  disabled: boolean
  selected: boolean
}

const grid = computed<DayCell[][]>(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = mondayIndex(first)

  const cells: DayCell[] = []
  for (let i = 0; i < lead; i++) cells.push({ key: `lead${i}`, day: null, disabled: true, selected: false })

  const minDay = startOfDay(props.min ?? Date.now())
  const selDay = startOfDay(picked.value)

  for (let d = 1; d <= daysInMonth; d++) {
    const ts = new Date(year, month, d).getTime()
    cells.push({
      key: `d${d}`,
      day: d,
      disabled: ts < minDay,
      selected: ts === selDay
    })
  }

  // 补齐到整周，最后一行不留半截
  while (cells.length % 7 !== 0) cells.push({ key: `tail${cells.length}`, day: null, disabled: true, selected: false })

  const weeks: DayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
})

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 上/下月切换。往前翻不能翻到 min 所在月之前 */
const canPrev = computed(() => {
  const minDate = new Date(props.min ?? Date.now())
  const cur = new Date(viewYear.value, viewMonth.value, 1)
  return cur > new Date(minDate.getFullYear(), minDate.getMonth(), 1)
})

function shiftMonth(delta: number) {
  if (delta < 0 && !canPrev.value) return
  const d = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = d.getFullYear()
  viewMonth.value = d.getMonth()
}

function pickDay(cell: DayCell) {
  if (!cell.day || cell.disabled) return
  const next = new Date(viewYear.value, viewMonth.value, cell.day)
  const cur = new Date(picked.value)
  next.setHours(cur.getHours(), cur.getMinutes(), 0, 0)
  picked.value = next.getTime()
}

/* ---------------- 时间 ---------------- */

const hour = computed(() => pickedDate.value.getHours())
const minute = computed(() => pickedDate.value.getMinutes())

function setTime(h: number, m: number) {
  const d = new Date(picked.value)
  d.setHours(h, m, 0, 0)
  picked.value = d.getTime()
}

function pickQuick(t: string) {
  const [h, m] = t.split(':').map(Number)
  setTime(h, m)
}

const quickActive = computed(() => {
  const hh = String(hour.value).padStart(2, '0')
  const mm = String(minute.value).padStart(2, '0')
  return QUICK_TIMES.find((t) => t === `${hh}:${mm}`) ?? ''
})

/* 滚轮：只渲染当前值上下各两格，靠 CSS 定位到中间，不做无限循环 */
const hourList = computed(() => {
  const base = hour.value
  return [-2, -1, 0, 1, 2].map((offset) => {
    const v = (base + offset + 24) % 24
    return { value: v, label: String(v).padStart(2, '0'), offset }
  })
})

const minuteList = computed(() => {
  const base = minute.value
  return [-2, -1, 0, 1, 2].map((offset) => {
    const v = (base + offset + 60) % 60
    return { value: v, label: String(v).padStart(2, '0'), offset }
  })
})

/**
 * 点上下相邻格就前进/后退一格。
 * 设计稿的滚轮是滑动选择，小程序里手写惯性滚动容易和页面滚动打架，
 * 这里用「点一下走一格」——行为可预期，也不会误触。
 */
function stepHour(delta: number) {
  setTime((hour.value + delta + 24) % 24, minute.value)
}

function stepMinute(delta: number) {
  setTime(hour.value, (minute.value + delta + 60) % 60)
}

/* ---------------- 输出 ---------------- */

/** 「2026 年 10 月 25 日」 */
const dateLabel = computed(() => {
  const d = pickedDate.value
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

/** 「2026 年 10 月 25 日 18:00」，给底部时间行用 */
const fullLabel = computed(() => {
  const d = pickedDate.value
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dateLabel.value} ${hh}:${mm}`
})

function onConfirm() {
  emit('confirm', picked.value)
}
</script>

<template>
  <view v-if="visible" class="dtp">
    <view class="dtp__mask anim anim--fade" @tap="emit('close')" />

    <view class="dtp__panel" :style="{ paddingBottom: panelPad }">
      <view class="dtp__handle"><view class="dtp__bar" /></view>

      <!-- 34/35 顶部分段控件：日期 / 时间 -->
      <view class="seg">
        <view
          class="seg__item"
          :class="{ 'seg__item--on': tab === 'date' }"
          @tap="tab = 'date'"
        >
          <text class="seg__text" :class="{ 'seg__text--on': tab === 'date' }">日期</text>
        </view>
        <view
          class="seg__item"
          :class="{ 'seg__item--on': tab === 'time' }"
          @tap="tab = 'time'"
        >
          <text class="seg__text" :class="{ 'seg__text--on': tab === 'time' }">时间</text>
        </view>
      </view>

      <!-- ---------- 34 日期页 ---------- -->
      <template v-if="tab === 'date'">
        <view class="dtp__head">
          <text class="dtp__title">选择截止时间</text>
          <view class="dtp__close" hover-class="dtp__close--active" @tap="emit('close')">
            <AppIcon name="x" :size="14" color="#71717A" />
          </view>
        </view>

        <view class="cal">
          <view class="cal__nav">
            <view
              class="cal__arrow"
              :class="{ 'cal__arrow--off': !canPrev }"
              hover-class="cal__arrow--active"
              @tap="shiftMonth(-1)"
            >
              <AppIcon name="chevron-left" :size="15" :color="canPrev ? '#71717A' : '#D4D4D8'" />
            </view>
            <text class="cal__month">{{ monthLabel }}</text>
            <view class="cal__arrow" hover-class="cal__arrow--active" @tap="shiftMonth(1)">
              <AppIcon name="chevron-right" :size="15" color="#71717A" />
            </view>
          </view>

          <view class="cal__weekdays">
            <text v-for="w in WEEKDAYS" :key="w" class="cal__weekday">{{ w }}</text>
          </view>

          <view class="cal__grid">
            <view v-for="(week, wi) in grid" :key="wi" class="cal__week">
              <view
                v-for="cell in week"
                :key="cell.key"
                class="cal__day"
                :class="{
                  'cal__day--on': cell.selected,
                  'cal__day--off': cell.disabled && cell.day !== null
                }"
                :hover-class="cell.day && !cell.disabled ? 'cal__day--active' : 'none'"
                @tap="pickDay(cell)"
              >
                <text
                  v-if="cell.day"
                  class="cal__day-text"
                  :class="{ 'cal__day-text--on': cell.selected }"
                >{{ cell.day }}</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 底部时间行：点一下切到时间页 -->
        <view class="time-row" hover-class="time-row--active" @tap="tab = 'time'">
          <view class="time-row__left">
            <AppIcon name="calendar-clock" :size="14" color="#71717A" />
            <text class="time-row__text">{{ fullLabel }}</text>
          </view>
          <AppIcon name="chevron-right" :size="14" color="#A1A1AA" />
        </view>

        <view class="dtp__confirm" hover-class="dtp__confirm--active" @tap="onConfirm">
          <text class="dtp__confirm-text">确定</text>
        </view>
      </template>

      <!-- ---------- 35 时间页 ---------- -->
      <template v-else>
        <view class="dtp__head">
          <text class="dtp__title">选择截止时间</text>
          <view class="dtp__close" hover-class="dtp__close--active" @tap="emit('close')">
            <AppIcon name="x" :size="14" color="#71717A" />
          </view>
        </view>

        <view class="sub">
          <text class="sub__date">{{ dateLabel }}</text>
          <view class="sub__change" hover-class="sub__change--active" @tap="tab = 'date'">
            <text class="sub__change-text">改日期</text>
            <AppIcon name="chevron-right" :size="12" color="#4F46E5" />
          </view>
        </view>

        <view class="quick">
          <view
            v-for="t in QUICK_TIMES"
            :key="t"
            class="quick__chip"
            :class="{ 'quick__chip--on': quickActive === t }"
            hover-class="quick__chip--active"
            @tap="pickQuick(t)"
          >
            <text class="quick__text" :class="{ 'quick__text--on': quickActive === t }">{{ t }}</text>
          </view>
        </view>

        <view class="wheel">
          <view class="wheel__band" />

          <view class="wheel__col">
            <view
              v-for="h in hourList"
              :key="`h${h.offset}`"
              class="wheel__cell"
              :class="{ 'wheel__cell--mid': h.offset === 0 }"
              @tap="h.offset !== 0 && stepHour(h.offset)"
            >
              <text
                class="wheel__text"
                :class="{
                  'wheel__text--mid': h.offset === 0,
                  'wheel__text--near': Math.abs(h.offset) === 1
                }"
              >{{ h.label }}</text>
            </view>
          </view>

          <text class="wheel__colon">:</text>

          <view class="wheel__col">
            <view
              v-for="m in minuteList"
              :key="`m${m.offset}`"
              class="wheel__cell"
              :class="{ 'wheel__cell--mid': m.offset === 0 }"
              @tap="m.offset !== 0 && stepMinute(m.offset)"
            >
              <text
                class="wheel__text"
                :class="{
                  'wheel__text--mid': m.offset === 0,
                  'wheel__text--near': Math.abs(m.offset) === 1
                }"
              >{{ m.label }}</text>
            </view>
          </view>
        </view>

        <view class="hint">
          <AppIcon name="move-vertical" :size="11" color="#A1A1AA" />
          <text class="hint__text">点上下两侧的数字调整小时与分钟</text>
        </view>

        <view class="dtp__confirm" hover-class="dtp__confirm--active" @tap="onConfirm">
          <text class="dtp__confirm-text">确定</text>
        </view>
      </template>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'AppDateTimePicker' }
</script>

<style lang="scss" scoped>
.dtp {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;

  &__mask {
    position: absolute;
    inset: 0;
    background: rgba(9, 9, 11, 0.4);
  }

  /* 设计稿 34：面板 gap 14、padding [10,20,24,20]、上沿圆角 20 */
  &__panel {
    position: relative;
    width: 100%;
    background: $surface;
    border-radius: $r-sheet $r-sheet 0 0;
    padding: 10px $gutter 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: dyx-sheet-up $dur-base $ease-out both;
  }

  &__handle {
    height: 4px;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  &__bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: $line;
  }

  /* 标题 18/700，右侧 28 的关闭钮 */
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  &__title {
    font-size: 18px;
    font-weight: 700;
    color: $ink;
  }

  &__close {
    width: 28px;
    height: 28px;
    border-radius: 14px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.7;
    }
  }

  /* 设计稿：48 高、圆角 14、$accent 底、14/600 白字 */
  &__confirm {
    height: 48px;
    border-radius: 14px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.86;
    }
  }

  &__confirm-text {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }
}

/* 分段控件：34 高、$subtle 底、圆角 10、内边距 3、间距 3 */
.seg {
  height: 34px;
  padding: 3px;
  border-radius: 10px;
  background: $subtle;
  display: flex;
  gap: 3px;
  flex-shrink: 0;

  &__item {
    flex: 1;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-both;

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;
    transition: color $dur-fast $ease-both;

    &--on {
      font-weight: 600;
      color: $ink;
    }
  }
}

/* ---------- 34 日期 ---------- */
.cal {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* 设计稿：32×32、$subtle 底、圆角 10 */
  &__arrow {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity $dur-fast $ease-both;

    &--active {
      opacity: 0.7;
    }

    &--off {
      opacity: 0.45;
    }
  }

  &__month {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__weekdays {
    display: flex;
    gap: 4px;
  }

  &__weekday {
    flex: 1;
    height: 20px;
    line-height: 20px;
    text-align: center;
    font-size: 11px;
    color: $faint;
  }

  &__grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__week {
    display: flex;
    gap: 4px;
  }

  /* 设计稿：38 高、圆角 10、未选中透明底 */
  &__day {
    flex: 1;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-both;

    &--on {
      background: $accent;
    }

    &--active {
      background: $subtle;
    }

    &--off {
      opacity: 0.35;
    }
  }

  &__day-text {
    font-size: 13px;
    color: $ink;

    &--on {
      font-weight: 600;
      color: #fff;
    }
  }
}

/* 底部时间行：48 高、圆角 12、1px 描边 */
.time-row {
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &--active {
    background: $subtle;
  }

  &__left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__text {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }
}

/* ---------- 35 时间 ---------- */
.sub {
  display: flex;
  align-items: center;
  justify-content: space-between;

  &__date {
    font-size: 12px;
    color: $muted;
  }

  &__change {
    display: flex;
    align-items: center;
    gap: 3px;

    &--active {
      opacity: 0.7;
    }
  }

  &__change-text {
    font-size: 12px;
    font-weight: 600;
    color: $accent;
  }
}

.quick {
  display: flex;
  gap: 8px;

  /* 设计稿：36 高、圆角 10、白底描边；选中 $accent 底白字 */
  &__chip {
    flex: 1;
    height: 36px;
    border-radius: 10px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-both;

    &--on {
      background: $accent;
      border-color: $accent;
    }

    &--active {
      opacity: 0.8;
    }
  }

  &__text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;

    &--on {
      font-weight: 600;
      color: #fff;
    }
  }
}

/* 滚轮：186 高，中间一条 164×48 的 $accent-soft 选中带 */
.wheel {
  position: relative;
  height: 186px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &__band {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 164px;
    height: 48px;
    margin: -24px 0 0 -82px;
    border-radius: 12px;
    background: $accent-soft;
    pointer-events: none;
  }

  &__col {
    position: relative;
    width: 72px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  &__cell {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform $dur-fast $ease-both;

    &--mid {
      height: 52px;
    }
  }

  &__text {
    font-size: 18px;
    color: $faint;
    font-family: $font-num;
    transition: font-size $dur-fast $ease-both, color $dur-fast $ease-both;

    /* 相邻一格稍深，远处的更淡，制造纵深 */
    &--near {
      color: $muted;
    }

    /* 中间：24/700 $accent-ink */
    &--mid {
      font-size: 24px;
      font-weight: 700;
      color: $accent-ink;
    }
  }

  &__colon {
    /* 选中带是绝对定位的，会盖住静态流里的元素 —— 冒号必须自己也定位才能浮上来 */
    position: relative;
    font-size: 20px;
    font-weight: 700;
    color: $ink;
    margin-top: -4px;
  }
}

.hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;

  &__text {
    font-size: 10px;
    color: $faint;
  }
}
</style>
