<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { JoinMethod, ResultVisibility } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppSwitch from '@/components/base/AppSwitch.vue'
import AppDateTimePicker from '@/components/base/AppDateTimePicker.vue'
import StepBar from '@/components/business/StepBar.vue'
import RuleRow from '@/components/business/RuleRow.vue'
import { useDraftStore } from '@/stores/draft'
import { formatDateTime } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { back, exitFlow, go, ROUTES } from '@/utils/router'

/**
 * 30 创建 · ③ 规则 · 单选 / 31 · 多选 / 63 · 问卷（含 32/34/35/36/37/38 六个弹层）
 *
 * 规则页只做一件事：把「谁能投、投几次、能不能看结果」这三件事定下来。
 * 所有选项都用一个通用弹层（AppSheet + 单选列表）承载，不为每种规则各画一个——
 * 设计稿里 32/36/37 三个弹层骨架完全一样，只有标题和选项不同。
 *
 * 31 多选比 30 多一行「最多可选」，值用 1–9 的横向胶囊。
 * 63 问卷去掉只对选项有意义的四条，换成「允许重复提交」。
 */
const draft = useDraftStore()

const isSurvey = computed(() => draft.draft.type === 'survey')

/** 单选 / 多选分段 */
const typeMode = ref<'single' | 'multiple'>('single')
const maxChoice = ref(3)

/**
 * 多选的「最多可选」上限 = 用户实际填写的选项数。
 *
 * 以前写死 9，选项只有 3 个时也能加到 9，详情页就出现「最多选 9 项」但只有 3 个可勾，
 * 规则自相矛盾。空标题的选项不会提交，计数时一并排除。
 * 下限固定 2：多选的上限是 1 的话，和单选没区别。
 */
const optionCount = computed(
  () => draft.draft.options.filter((o) => o.title.trim()).length
)
const maxChoiceMax = computed(() => Math.max(2, optionCount.value))

/**
 * 把 maxChoice 收进 [2, 选项数] 区间；选项增删、回填草稿后都要调一次。
 * 顺手写回草稿：不写的话，回上一步改完选项再进来，用户刚调的上限会丢。
 */
function clampMaxChoice() {
  const next = Math.min(Math.max(2, maxChoice.value), maxChoiceMax.value)
  if (next === maxChoice.value) return
  maxChoice.value = next
  draft.patchRules({ maxChoice: next })
}

function stepMaxChoice(delta: number) {
  maxChoice.value = Math.min(Math.max(2, maxChoice.value + delta), maxChoiceMax.value)
  draft.patchRules({ maxChoice: maxChoice.value })
}

// 从内容页返回后如果删过选项，草稿里的上限可能比选项数还大
watch(optionCount, clampMaxChoice)

/** 通用弹层 */
type SheetKind = 'join' | 'result' | 'profile' | null
const sheet = ref<SheetKind>(null)

/** 需填信息：两个输入 */
const profileTitle = ref('')
const profileHint = ref('')

/** 截止时间：天快捷 + 自定义日期时间（自定义走 34/35 面板） */
const deadlinePreset = ref<'1d' | '3d' | '7d' | 'custom'>('3d')
const deadlinePicker = ref(false)
/** 面板打开时的草稿值，只有点「确定」才写回 draft */
const customDeadline = ref(0)

const joinOptions: Array<{ value: JoinMethod; label: string; desc: string }> = [
  { value: 'link', label: '链接分享', desc: '拿到链接的人都能参与，适合群内公开征集' },
  { value: 'invite', label: '邀请码', desc: '参与者需单独输入 6 位码，转发链接也进不来' }
]

const resultOptions: Array<{ value: ResultVisibility; label: string; desc: string }> = [
  { value: 'after_vote', label: '投票后查看', desc: '投完票立刻能看到实时票数' },
  { value: 'hidden', label: '禁止查看', desc: '任何人在任何阶段都看不到票数' },
  { value: 'after_end', label: '投票结束后查看', desc: '截止后才公布结果，避免影响判断' },
  { value: 'always', label: '投票前查看', desc: '投票前就能看到当前票数' }
]

const joinText = computed(
  () => joinOptions.find((o) => o.value === draft.draft.rules.joinMethod)?.label ?? '链接分享'
)
const resultText = computed(
  () => resultOptions.find((o) => o.value === draft.draft.rules.resultVisibility)?.label ?? '投票后查看'
)

onLoad(() => {
  draft.restore()
  typeMode.value = draft.draft.type === 'multiple' ? 'multiple' : 'single'
  // 旧草稿里可能是 null / NaN（JSON 存不下 NaN，会变成 null），兜到 3 再收口
  const savedMax = draft.draft.rules.maxChoice
  maxChoice.value = typeof savedMax === 'number' && Number.isFinite(savedMax) ? savedMax : 3
  clampMaxChoice()
  profileTitle.value = draft.draft.rules.profileField ?? ''
  // 回填截止时间：草稿里已有 endAt 就按它和「现在 + 1/3/7 天」比对，
  // 对不上任何快捷档就落到「自定义」，否则用户会看到选中了「3 天」但时间对不上
  const endAt = draft.draft.rules.endAt
  const day = 24 * 3600 * 1000
  const near = endAt
    ? ([1, 3, 7] as const).find((d) => Math.abs(endAt - (Date.now() + d * day)) < 60 * 1000)
    : undefined
  deadlinePreset.value = near === 1 ? '1d' : near === 3 ? '3d' : near === 7 ? '7d' : 'custom'
})

/**
 * 所有开关都直接写回 draft，页面不持有副本，避免「改了没保存」。
 * 必须走 patchRules：直接改 draft.rules.xxx 不会换引用，页面不会重渲染。
 */
function setRule(key: string, v: boolean) {
  draft.patchRules({ [key]: v } as Partial<typeof draft.draft.rules>)
}

function pickJoin(v: JoinMethod) {
  draft.patchRules({ joinMethod: v })
  closeSheet()
}

function pickResult(v: ResultVisibility) {
  draft.patchRules({ resultVisibility: v })
  closeSheet()
}

/**
 * 关弹层。
 *
 * 「需个人信息」里有两个输入框：输入框还聚焦着就把面板从树上摘掉，
 * 微信会把键盘留在屏幕上、页面停在「被顶起」的位置，
 * 看起来就是整页卡住点不动。关之前先主动收键盘。
 */
function closeSheet() {
  if (sheet.value === 'profile') {
    // 个别宿主没有这个能力，收不起来也不能让关闭动作本身失败
    try {
      uni.hideKeyboard()
    } catch {
      /* ignore */
    }
  }
  sheet.value = null
}

function confirmProfile() {
  const t = profileTitle.value.trim()
  draft.patchRules({ profileField: t || null })
  closeSheet()
}

function pickDeadline(p: '1d' | '3d' | '7d' | 'custom') {
  if (p === 'custom') {
    openDeadlinePicker()
    return
  }
  deadlinePreset.value = p
  const days = p === '1d' ? 1 : p === '3d' ? 3 : 7
  draft.patchRules({ endAt: Date.now() + days * 24 * 3600 * 1000 })
}

/** 打开 34：用当前截止时间作为初始值，没有就默认 3 天后 18:00 */
function openDeadlinePicker() {
  customDeadline.value = draft.draft.rules.endAt || Date.now() + 3 * 86400000
  deadlinePicker.value = true
}

function applyCustomDeadline(ts: number) {
  const now = Date.now()
  // 选到已经过去的时间就顺延到 5 分钟后。
  // 以前是弹个提示原地不动 —— 面板不关、值也不变，用户只能反复点「确定」，
  // 看起来就是「点确定没反应」。
  if (ts <= now) {
    ts = now + 5 * 60 * 1000
    uni.showToast({ title: '已顺延到最近的可选时间', icon: 'none' })
  }
  deadlinePreset.value = 'custom'
  draft.patchRules({ endAt: ts })
  deadlinePicker.value = false
}

function onBack() {
  back()
}

/**
 * 左上角「取消」= 放弃整个创建流程，回进入流程前的那一页。
 * 底部「上一步」才是退到上一步骤，两者语义不同，不能共用。
 * 草稿保留，下次进来还能续上。
 *
 * 退出走 exitFlow()，别用 reLaunch：H5 上会先白屏一帧再回到首页。
 */
function cancel() {
  exitFlow()
}

function publish() {
  if (typeMode.value === 'multiple') draft.draft.type = 'multiple'
  else if (draft.draft.type !== 'survey') draft.draft.type = 'single'
  // 上限写进规则，详情页和待办卡都读这一个值，不在各处再猜。
  // 发布前再收一次口，防止选项在别处被删到比上限还少。
  draft.draft.rules.maxChoice =
    typeMode.value === 'multiple' ? Math.min(maxChoice.value, maxChoiceMax.value) : 1
  draft.patch({})
  go(ROUTES.createSuccess)
}
</script>

<template>
  <view class="rules">
    <AppNavBar :back="false">
      <template #left>
        <text class="rules__cancel" @tap="cancel">取消</text>
      </template>
      <template #title>
        <text class="rules__nav-title">新建{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="rules__draft">
          <text class="rules__draft-text">草稿</text>
        </view>
      </template>
    </AppNavBar>

    <!-- 步骤条和导航栏一起吸顶：它不在 scroll-view 里，所以只有下面的内容在滚 -->
    <view class="rules__steps">
      <StepBar :current="3" />
    </view>

    <scroll-view class="rules__scroll" scroll-y>
      <view class="rules__inner">
        <view class="head">
          <text class="head__title">{{ isSurvey ? '问卷规则' : '投票规则' }}</text>
          <text class="head__sub">
            {{ isSurvey ? '决定谁能答、能否改、能否重复提交' : '决定谁能投、投几次、能否看到结果' }}
          </text>
        </view>

        <!-- 来自问卷的说明（87） -->
        <view v-if="draft.draft.sourceSurveyId && !isSurvey" class="from-survey">
          <text class="from-survey__text">
            {{ draft.draft.options.length }} 个选项来自这份问卷的回答；规则与普通投票完全一致，可随时回到上一步调整选项。
          </text>
        </view>

        <!-- ================= 投票 ================= -->
        <view v-if="!isSurvey" class="card anim anim--fade-up">
          <RuleRow
            title="选择方式"
            :desc="typeMode === 'single' ? '每人只能选 1 项' : '每人可勾选多项'"
          >
            <view class="seg">
              <view
                class="seg__item"
                :class="{ 'seg__item--on': typeMode === 'single' }"
                @tap="typeMode = 'single'"
              >
                <text class="seg__text" :class="{ 'seg__text--on': typeMode === 'single' }">单选</text>
              </view>
              <view
                class="seg__item"
                :class="{ 'seg__item--on': typeMode === 'multiple' }"
                @tap="typeMode = 'multiple'; clampMaxChoice()"
              >
                <text class="seg__text" :class="{ 'seg__text--on': typeMode === 'multiple' }">多选</text>
              </view>
            </view>
          </RuleRow>

          <RuleRow
            v-if="typeMode === 'multiple'"
            title="最多可选"
            :desc="`最多 ${maxChoiceMax} 项，超过上限时禁止继续勾选`"
          >
            <!-- 设计稿 31：Stepper − 值 +，而不是一排数字块 -->
            <view class="stepper">
              <view
                class="stepper__btn"
                :class="{ 'stepper__btn--off': maxChoice <= 2 }"
                :hover-class="maxChoice <= 2 ? 'none' : 'stepper__btn--active'"
                @tap="stepMaxChoice(-1)"
              >
                <AppIcon name="minus" :size="13" color="#71717A" />
              </view>
              <text class="stepper__value">{{ maxChoice }}</text>
              <view
                class="stepper__btn"
                :class="{ 'stepper__btn--off': maxChoice >= maxChoiceMax }"
                :hover-class="maxChoice >= maxChoiceMax ? 'none' : 'stepper__btn--active'"
                @tap="stepMaxChoice(1)"
              >
                <AppIcon name="plus" :size="13" color="#09090B" />
              </view>
            </view>
          </RuleRow>

          <RuleRow title="匿名投票" desc="参与者身份不公开">
            <AppSwitch
              :model-value="draft.draft.rules.anonymous"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow title="允许修改选择" desc="截止前可重新提交">
            <AppSwitch
              :model-value="draft.draft.rules.allowEdit"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow title="选项随机排序" desc="每次打开顺序不同，减少位置影响">
            <AppSwitch
              :model-value="!!draft.draft.rules.shuffleOptions"
              @update:model-value="(v) => setRule('shuffleOptions', v)"
            />
          </RuleRow>

          <RuleRow title="允许参与者分享" desc="参与者可转发邀请更多人">
            <AppSwitch
              :model-value="draft.draft.rules.allowShare"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow title="限制同IP投票" desc="同一网络下仅计入一票">
            <AppSwitch
              :model-value="draft.draft.rules.limitIp"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow title="禁止查看投票人数" desc="隐藏参与人数，只展示得票比例">
            <AppSwitch
              :model-value="!!draft.draft.rules.hideVoterCount"
              @update:model-value="(v) => setRule('hideVoterCount', v)"
            />
          </RuleRow>

          <RuleRow
            title="投票结果显示"
            desc="决定参与者何时能看到票数"
            :value="resultText"
            clickable
            @tap="sheet = 'result'"
          />

          <RuleRow title="允许评论" desc="参与者可在讨论区留言交流">
            <AppSwitch
              :model-value="draft.draft.rules.allowComment"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow
            title="需个人信息"
            desc="参与前需填写发起人指定的信息"
            :value="draft.draft.rules.profileField ?? '未设置'"
            clickable
            @tap="sheet = 'profile'"
          />

          <RuleRow
            title="参与方式"
            desc="谁可以看到并参与这个投票"
            :value="joinText"
            clickable
            @tap="sheet = 'join'"
          />
        </view>

        <!-- ================= 问卷 ================= -->
        <view v-else class="card anim anim--fade-up">
          <RuleRow title="匿名收集" desc="回答者身份不公开">
            <AppSwitch
              :model-value="draft.draft.rules.anonymous"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow title="允许修改回答" desc="提交后可编辑这条回答，总数不变">
            <AppSwitch
              :model-value="draft.draft.rules.allowEdit"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow title="允许参与者分享" desc="参与者可转发邀请更多人">
            <AppSwitch
              :model-value="draft.draft.rules.allowShare"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow title="限制同IP提交" desc="同一网络下仅计入一份回答">
            <AppSwitch
              :model-value="draft.draft.rules.limitIp"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow title="允许评论" desc="参与者可在讨论区留言交流">
            <AppSwitch
              :model-value="draft.draft.rules.allowComment"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow title="允许重复提交" desc="同一人可再提交新的一条，独立计入总数">
            <AppSwitch
              :model-value="!!draft.draft.rules.allowRepeat"
              @update:model-value="(v) => setRule('allowRepeat', v)"
            />
          </RuleRow>

          <RuleRow
            title="需个人信息"
            desc="参与前需填写发起人指定的信息"
            :value="draft.draft.rules.profileField ?? '未设置'"
            clickable
            @tap="sheet = 'profile'"
          />

          <RuleRow
            title="参与方式"
            desc="谁可以看到并参与这份问卷"
            :value="joinText"
            clickable
            @tap="sheet = 'join'"
          />
        </view>

        <!-- 截止时间（投票 / 问卷共用）· 设计稿 30 的独立一节 -->
        <view class="deadline anim anim--fade-up" :style="{ animationDelay: '80ms' }">
          <view class="deadline__head">
            <text class="deadline__title">截止时间</text>
            <text class="deadline__req">必填</text>
          </view>

          <view class="deadline__options">
            <view
              v-for="p in [
                { key: '1d', label: '1 天' },
                { key: '3d', label: '3 天' },
                { key: '7d', label: '7 天' },
                { key: 'custom', label: '自定义' }
              ]"
              :key="p.key"
              class="deadline__opt"
              :class="{ 'deadline__opt--on': deadlinePreset === p.key }"
              @tap="pickDeadline(p.key as any)"
            >
              <text
                class="deadline__opt-text"
                :class="{ 'deadline__opt-text--on': deadlinePreset === p.key }"
              >
                {{ p.label }}
              </text>
            </view>
          </view>

          <view
            class="deadline__value"
            hover-class="deadline__value--active"
            @tap="openDeadlinePicker"
          >
            <AppIcon name="calendar" :size="16" color="#71717A" />
            <text class="deadline__value-text">{{ formatDateTime(draft.draft.rules.endAt) }}</text>
            <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="rules__actions" :style="{ paddingBottom: bottomInset(20) }">
      <view class="rules__prev" hover-class="rules__prev--active" @tap="onBack">
        <text class="rules__prev-text">上一步</text>
      </view>
      <view class="rules__next" hover-class="rules__next--active" @tap="publish">
        <text class="rules__next-text">发布</text>
      </view>
    </view>

    <!-- 32 参与方式 -->
    <AppSheet
      :visible="sheet === 'join'"
      title="参与方式"
      desc="决定谁可以看到并参与"
      @close="closeSheet"
    >
      <view class="picker">
        <view
          v-for="o in joinOptions"
          :key="o.value"
          class="picker__item"
          :class="{ 'picker__item--on': draft.draft.rules.joinMethod === o.value }"
          @tap="pickJoin(o.value)"
        >
          <view class="picker__text">
            <text class="picker__label">{{ o.label }}</text>
            <text class="picker__desc">{{ o.desc }}</text>
          </view>
          <view
            v-if="draft.draft.rules.joinMethod === o.value"
            class="picker__check anim anim--pop"
          >
            <AppIcon name="check" :size="11" color="#FFFFFF" :stroke-width="3" />
          </view>
        </view>
      </view>
    </AppSheet>

    <!-- 36 投票结果显示 -->
    <AppSheet
      :visible="sheet === 'result'"
      title="投票结果显示"
      desc="决定参与者什么时候能看到票数"
      @close="closeSheet"
    >
      <view class="picker">
        <view
          v-for="o in resultOptions"
          :key="o.value"
          class="picker__item"
          :class="{ 'picker__item--on': draft.draft.rules.resultVisibility === o.value }"
          @tap="pickResult(o.value)"
        >
          <view class="picker__text">
            <text class="picker__label">{{ o.label }}</text>
            <text class="picker__desc">{{ o.desc }}</text>
          </view>
          <view
            v-if="draft.draft.rules.resultVisibility === o.value"
            class="picker__check anim anim--pop"
          >
            <AppIcon name="check" :size="11" color="#FFFFFF" :stroke-width="3" />
          </view>
        </view>
      </view>
    </AppSheet>

    <!-- 37/38 需个人信息 -->
    <AppSheet
      :visible="sheet === 'profile'"
      title="需个人信息"
      desc="配置后，参与者投票前需先填写该信息"
      @close="closeSheet"
    >
      <view class="form">
        <view class="form__group">
          <text class="form__label">标题</text>
          <view class="form__input">
            <input
              v-model="profileTitle"
              maxlength="12"
              placeholder="例如：部门、工号"
              placeholder-class="form__ph"
            />
          </view>
          <text class="form__hint">字段名称，参与者看到的标签</text>
        </view>

        <view class="form__group">
          <text class="form__label">内容</text>
          <view class="form__input">
            <input
              v-model="profileHint"
              maxlength="30"
              placeholder="补充说明，例如填写要求、格式提示"
              placeholder-class="form__ph"
            />
          </view>
          <text class="form__hint">提示参与者该填什么，可留空</text>
        </view>
      </view>

      <template #footer>
        <AppButton :disabled="!profileTitle.trim()" @tap="confirmProfile">确定</AppButton>
      </template>
    </AppSheet>

    <!-- 34/35 自定义截止时间：自绘面板，替换原来的原生 <picker> -->
    <AppDateTimePicker
      :visible="deadlinePicker"
      :model-value="customDeadline"
      :min="Date.now()"
      @close="deadlinePicker = false"
      @confirm="applyCustomDeadline"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'CreateRulesPage' }
</script>

<style lang="scss" scoped>
.rules {
  /*
   * 定高而不是 min-height：容器 auto 高时里面的 scroll-view 会被内容撑开，
   * 变成整页在滚、底部操作栏跟着跑。定成 100vh 后滚动交给 scroll-view，
   * 导航栏、步骤条、操作栏三块才固定得住。
   */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__cancel {
    font-size: 14px;
    color: $muted;
  }

  &__nav-title {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
  }

  &__draft {
    padding: 5px 10px;
    border-radius: 8px;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__draft-text {
    font-size: 11px;
    font-weight: 600;
    color: $accent;
  }

  /*
   * 步骤条：和导航栏一起固定在顶部，不进 scroll-view。
   * 放在滚动容器外面比 sticky 稳 —— 小程序里 sticky 在 scroll-view 内并不可靠。
   */
  &__steps {
    flex-shrink: 0;
    /* 下边留 8：滚动内容在这里被裁掉，贴着「1 方式 2 内容 3 规则」会显得很挤 */
    padding: 4px $gutter 8px;
    background: $bg;
  }

  &__scroll {
    flex: 1;
    height: 0;
    /* flex 项默认 min-height: auto，会被内容撑开而不是内部滚动 —— 步骤条就白吸顶了 */
    min-height: 0;
  }

  /* 上内边距和步骤条的下边距合起来，还是原来那条 16 的间距 */
  &__inner {
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__prev {
    flex: 1;
    height: 52px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color $dur-fast $ease-both;

    &--active {
      background: $subtle;
    }
  }

  &__prev-text {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__next {
    flex: 1;
    height: 52px;
    border-radius: 14px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity $dur-fast $ease-both;

    &--active {
      opacity: 0.85;
    }
  }

  &__next-text {
    font-size: 14px;
    font-weight: 600;
    color: $white;
  }
}

.head {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__title {
    font-size: 20px;
    font-weight: 700;
    color: $ink;
  }

  &__sub {
    font-size: 12px;
    color: $muted;
  }
}

.from-survey {
  padding: 12px 14px;
  border-radius: 12px;
  background: $accent-soft;

  &__text {
    font-size: 11px;
    color: $accent-ink;
    line-height: 1.55;
  }
}

.card {
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;
  overflow: hidden;
}

/* 单选 / 多选分段 */
.seg {
  display: flex;
  background: $subtle;
  border-radius: 9px;
  padding: 3px;
  gap: 3px;
  flex-shrink: 0;

  &__item {
    padding: 5px 10px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    transition: background-color $dur-fast $ease-both;

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: 12px;
    color: $muted;
    transition: color $dur-fast $ease-both;

    &--on {
      color: $ink;
      font-weight: 600;
    }
  }
}

/* 最多可选：设计稿 31 的 Stepper（白底、$line 描边、r8、30 高） */
.stepper {
  display: flex;
  align-items: center;
  height: 30px;
  border-radius: 8px;
  background: $surface;
  border: 1px solid $line;
  flex-shrink: 0;

  &__btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity $dur-fast $ease-both;

    &--active {
      opacity: 0.6;
    }

    /* 到边界了：视觉上变灰，同时 hover-class 已被换成 none，不会再给按压反馈 */
    &--off {
      opacity: 0.3;
    }
  }

  &__value {
    width: 32px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: $ink;
    font-family: $font-num;
  }
}

/* 截止时间：设计稿 30 —— 标题行 + 4 个等宽 44 高选项 + 52 高取值行 */
.deadline {
  display: flex;
  flex-direction: column;
  gap: 9px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__req {
    font-size: 10px;
    color: $faint;
  }

  &__options {
    display: flex;
    gap: 8px;
  }

  &__opt {
    flex: 1;
    padding: 10px 0;
    border-radius: 10px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color $dur-fast $ease-both,
      border-color $dur-fast $ease-both;

    &--on {
      background: $accent;
      border-color: $accent;
    }
  }

  &__opt-text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;
    transition: color $dur-fast $ease-both;

    &--on {
      color: $white;
      font-weight: 600;
    }
  }

  &__value {
    height: 52px;
    padding: 0 14px;
    border-radius: 10px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background-color $dur-fast $ease-both;

    &--active {
      background: $subtle;
    }
  }

  &__value-text {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }
}

/* 通用单选弹层 */
.picker {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__item {
    padding: 14px;
    border-radius: 14px;
    background: $bg;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 12px;
    transition:
      background-color $dur-fast $ease-both,
      border-color $dur-fast $ease-both;

    &--on {
      background: $accent-soft;
      border-color: $accent;
    }
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__label {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.4;
  }

  &__check {
    width: 20px;
    height: 20px;
    border-radius: 10px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}

/* 表单弹层 */
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 4px;

  &__group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__input {
    height: 46px;
    padding: 0 14px;
    border-radius: 12px;
    background: $subtle;
    display: flex;
    align-items: center;
    font-size: 14px;
    color: $ink;

    &--picker {
      justify-content: space-between;
    }
  }

  &__picker-text {
    font-size: 14px;
    color: $ink;
  }

  &__hint {
    font-size: 11px;
    color: $faint;
  }

  &__ph {
    color: $faint;
  }
}
</style>
