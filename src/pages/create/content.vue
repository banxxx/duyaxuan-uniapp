<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
import StepBar from '@/components/business/StepBar.vue'
import { useDraftStore } from '@/stores/draft'
import type { DraftOption } from '@/stores/draft'
import { uploadPollImage } from '@/api/poll'
import { resolveFileUrl } from '@/utils/api-base'
import { charCount } from '@/utils/format'
import { MAX_OPTION_IMAGES, chooseImage } from '@/utils/image'
import { bottomInset } from '@/utils/platform'
import { back, exitFlow, go, ROUTES } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 29 创建 · ② 内容（投票）/ 62 创建 · ② 内容（问卷）/ 33 添加选项弹层
 *
 * 同一页两种形态，由 draft.type 决定：
 *   投票 → 主题 + 说明 + 选项列表（可拖拽排序、可删）
 *   问卷 → 主题 + 说明 + 回答方式预览（只有一段说明，不可编辑）
 *
 * 选项不弹窗输入，直接内联编辑——设计稿 33 的「添加选项」弹层是给
 * 「标题 + 说明」两行一起填的场景，内联反而更快；这里保留弹层，
 * 因为拖拽手柄和序号要占掉一行宽度，内联两行会挤。
 */
const draft = useDraftStore()

const isSurvey = computed(() => draft.draft.type === 'survey')

/** 图文投票：选项可配图（在步骤① 选，单选/多选在步骤③ 定） */
const imageMode = computed(() => draft.draft.imageMode)

const title = ref('')
const desc = ref('')

/** 添加选项弹层（33） */
const sheetVisible = ref(false)

/** 长按选项：上移 / 下移 / 删除 */
const optionMenuVisible = ref(false)
const optionMenuIndex = ref(-1)
const optionMenuItems = computed(() => {
  const i = optionMenuIndex.value
  const last = draft.draft.options.length - 1
  return [
    { key: 'up', label: '上移', icon: 'chevron-up', disabled: i <= 0 },
    { key: 'down', label: '下移', icon: 'chevron-down', disabled: i >= last },
    { key: 'delete', label: '删除选项', icon: 'trash-2', danger: true }
  ]
})
const newTitle = ref('')
const newDesc = ref('')
/** 弹层里先攒着、点「添加」才落到选项上的图 */
const newImages = ref<string[]>([])

/**
 * 正在上传的图位：选项下标（字符串）或 'sheet'，null 表示空闲。
 * 同一时间只允许传一张 —— 连点两下会同时起两个上传，回来的顺序还不一定。
 */
const uploadingAt = ref<string | null>(null)

const TITLE_MAX = 60
const DESC_MAX = 200
const OPTION_MAX = 30
const OPTION_DESC_MAX = 40

onLoad(() => {
  draft.restore()
  title.value = draft.draft.title
  desc.value = draft.draft.desc
})

function syncToDraft() {
  // options 是数组，push/splice 本身会触发响应式；title/desc 走 patch 换新对象。
  // 这里把 options 一起带上，避免只改数组时 title/desc 的旧引用把它覆盖回去。
  draft.patch({ title: title.value, desc: desc.value, options: [...draft.draft.options] })
}

function goBack() {
  syncToDraft()
  back()
}

/**
 * 左上角「取消」= 放弃整个创建流程，回到进入流程前的那一页。
 * 不能和底部「上一步」共用 back() —— 那只是退回上一个步骤，
 * 用户点「取消」的语义是「不建了」，必须一次性退出向导。
 * 草稿仍然保留，下次进来能续上。
 *
 * 退出走 exitFlow()：一次性弹掉向导页而不是 reLaunch 重建首页，
 * 否则 H5 上会先白屏一帧再回到首页。
 */
function cancel() {
  syncToDraft()
  exitFlow()
}

/** 问卷 → 投票：回到汇总页重新挑选项。必须带上来源问卷 id，否则汇总页拿不到数据 */
function goSummary() {
  const source = draft.draft.sourceSurveyId
  if (!source) {
    toast.show('没有关联的问卷')
    return
  }
  go(ROUTES.summary, { surveyId: source })
}

function openAdd() {
  if (draft.draft.options.length >= 12) {
    toast.show('最多 12 个选项')
    return
  }
  newTitle.value = ''
  newDesc.value = ''
  newImages.value = []
  sheetVisible.value = true
}

/**
 * 添加选项。
 *
 * 幂等保护：小程序里自定义组件内部的原生 tap 会冒泡穿出组件边界，
 * 和组件自己 emit('tap') 叠加，父级 @tap 会收到两次 —— 表现就是
 * 「一次点击加两个选项」。AppButton 已经用 catchtap + 时间戳去重，
 * 这里再加一道闸：正在提交时忽略重复调用。
 */
let adding = false

function confirmAdd() {
  if (adding) return
  const t = newTitle.value.trim()
  if (!t) return
  adding = true
  draft.draft.options.push({
    title: t,
    desc: newDesc.value.trim() || undefined,
    images: newImages.value.length ? [...newImages.value] : undefined
  })
  sheetVisible.value = false
  syncToDraft()
  newTitle.value = ''
  newDesc.value = ''
  newImages.value = []
  // 下一帧再解锁，足以吃掉同一次点击产生的第二个事件
  setTimeout(() => {
    adding = false
  }, 300)
}

/* ---------------- 选项配图（图文投票） ---------------- */

/**
 * 选图 + 上传，返回服务端相对地址；取消或失败返回 null。
 *
 * 图是立刻上传的，不等发布：发布时再统一传，用户点完「发布」要盯着
 * 转圈好几秒，图越多越久。失败只提示，选项的其他内容不受影响。
 */
async function pickAndUpload(at: string): Promise<string | null> {
  if (uploadingAt.value) return null

  let path: string | null = null
  try {
    path = await chooseImage()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : '选择图片失败')
    return null
  }
  if (!path) return null // 用户取消

  uploadingAt.value = at
  try {
    return await uploadPollImage(path)
  } catch (err) {
    toast.show(err instanceof Error ? err.message : '上传失败，请重试')
    return null
  } finally {
    uploadingAt.value = null
  }
}

async function addOptionImage(index: number) {
  const opt = draft.draft.options[index]
  if (!opt) return
  if ((opt.images?.length ?? 0) >= MAX_OPTION_IMAGES) {
    toast.show(`最多 ${MAX_OPTION_IMAGES} 张图`)
    return
  }

  const url = await pickAndUpload(String(index))
  if (!url) return
  // 上传期间这一项可能被删掉或挪过位置，按对象引用重新确认一次
  if (!draft.draft.options.includes(opt)) return
  opt.images = [...(opt.images ?? []), url]
  syncToDraft()
}

function removeOptionImage(index: number, imgIndex: number) {
  const opt = draft.draft.options[index]
  if (!opt?.images) return
  opt.images = opt.images.filter((_, i) => i !== imgIndex)
  syncToDraft()
}

/** 点图看大图：带上这一项的全部图，左右能翻 */
function previewOptionImages(index: number, imgIndex: number) {
  const urls = (draft.draft.options[index]?.images ?? []).map(resolveFileUrl)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[Math.min(imgIndex, urls.length - 1)] })
}

async function addSheetImage() {
  if (newImages.value.length >= MAX_OPTION_IMAGES) {
    toast.show(`最多 ${MAX_OPTION_IMAGES} 张图`)
    return
  }
  const url = await pickAndUpload('sheet')
  if (url) newImages.value = [...newImages.value, url]
}

function removeSheetImage(imgIndex: number) {
  newImages.value = newImages.value.filter((_, i) => i !== imgIndex)
}

function previewSheetImages(imgIndex: number) {
  const urls = newImages.value.map(resolveFileUrl)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[Math.min(imgIndex, urls.length - 1)] })
}

function removeOption(i: number) {
  draft.draft.options.splice(i, 1)
  syncToDraft()
}

function moveOption(from: number, to: number) {
  if (to < 0 || to >= draft.draft.options.length) return
  const [item] = draft.draft.options.splice(from, 1)
  draft.draft.options.splice(to, 0, item)
  syncToDraft()
}

/** 长按上移 / 下移：小程序没有原生拖拽，用长按菜单代替 */
function onOptionLongPress(i: number) {
  optionMenuIndex.value = i
  optionMenuVisible.value = true
}

function onOptionAction(key: string) {
  const i = optionMenuIndex.value
  if (i < 0) return
  if (key === 'up') moveOption(i, i - 1)
  else if (key === 'down') moveOption(i, i + 1)
  else removeOption(i)
}

/** 图文投票至少要有一张图，否则和普通文字投票没区别 */
const hasImage = computed(() => draft.draft.options.some((o: DraftOption) => !!o.images?.length))

const canNext = computed(() => {
  if (!title.value.trim()) return false
  if (isSurvey.value) return true
  if (draft.draft.options.filter((o: DraftOption) => o.title.trim()).length < 2) return false
  return !imageMode.value || hasImage.value
})

function next() {
  syncToDraft()
  if (!title.value.trim()) {
    toast.show('先填投票主题')
    return
  }
  if (!isSurvey.value && draft.draft.options.length < 2) {
    toast.show('至少添加 2 个选项')
    return
  }
  if (!isSurvey.value && imageMode.value && !hasImage.value) {
    toast.show('至少给一个选项配张图')
    return
  }
  go(ROUTES.createRules)
}

/** 从问卷汇总进来（83）：选项已经带入，这里只提示来源 */
const fromSurvey = computed(() => !!draft.draft.sourceSurveyId)
</script>

<template>
  <view class="content">
    <AppToast />
    <AppNavBar :back="false">
      <template #left>
        <text class="content__cancel" @tap="cancel">取消</text>
      </template>
      <template #title>
        <text class="content__nav-title">新建{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="content__draft">
          <text class="content__draft-text">草稿</text>
        </view>
      </template>
    </AppNavBar>

    <!-- 步骤条和导航栏一起吸顶：它不在 scroll-view 里，所以只有下面的内容在滚 -->
    <view class="content__steps">
      <StepBar :current="2" />
    </view>

    <scroll-view class="content__scroll" scroll-y>
      <view class="content__inner">
        <!-- 投票主题 -->
        <view class="field">
          <text class="field__label">{{ isSurvey ? '问卷主题' : '投票主题' }}</text>
          <view class="field__input" :class="{ 'field__input--focus': title }">
            <input
              v-model="title"
              class="field__input-inner"
              :maxlength="TITLE_MAX"
              :placeholder="isSurvey ? '关于什么，一句话说清楚' : '例如：周末出游活动，你想安排哪些项目？'"
              placeholder-class="field__ph"
              @blur="syncToDraft"
            />
          </view>
          <view class="field__foot">
            <text class="field__hint">建议 20 字以内，说明清楚</text>
            <text class="field__count">{{ charCount(title) }}/{{ TITLE_MAX }}</text>
          </view>
        </view>

        <!-- 说明 -->
        <view class="field">
          <view class="field__head">
            <text class="field__label">{{ isSurvey ? '问卷说明' : '投票说明' }}</text>
            <text class="field__optional">选填</text>
          </view>
          <view class="field__textarea">
            <textarea
              v-model="desc"
              class="field__textarea-inner"
              :maxlength="DESC_MAX"
              :placeholder="
                isSurvey
                  ? '随便聊聊想去哪、想玩什么，我们会根据大家的回答整理方案。'
                  : '补充背景、规则或预算，帮助参与者判断'
              "
              placeholder-class="field__ph"
              @blur="syncToDraft"
            />
          </view>
          <view class="field__foot field__foot--end">
            <text class="field__count">{{ charCount(desc) }}/{{ DESC_MAX }}</text>
          </view>
        </view>

        <!-- 选项（投票） -->
        <view v-if="!isSurvey" class="field">
          <view class="field__head">
            <text class="field__label">选项</text>
            <text v-if="fromSurvey" class="field__link" @tap="goSummary">
              重新整理 ›
            </text>
            <text v-else class="field__optional">长按可排序 / 删除</text>
          </view>

          <view v-if="fromSurvey" class="from-survey">
            <text class="from-survey__text">
              已按回答数带入前 {{ draft.draft.options.length }} 个，其余在「重新整理」里勾选
            </text>
          </view>

          <view class="options">
            <view
              v-for="(opt, i) in draft.draft.options"
              :key="opt.id ?? `new-${i}`"
              class="opt anim anim--fade-up"
              :style="{ animationDelay: `${Math.min(i, 8) * 30}ms` }"
              @longpress="onOptionLongPress(i)"
            >
              <view class="opt__index">
                <text class="opt__index-text">{{ i + 1 }}</text>
              </view>
              <view class="opt__text">
                <input
                  v-model="opt.title"
                  class="opt__title-input"
                  :maxlength="OPTION_MAX"
                  placeholder="选项标题"
                  placeholder-class="field__ph"
                  @blur="syncToDraft"
                />
                <input
                  v-model="opt.desc"
                  class="opt__desc-input"
                  :maxlength="OPTION_DESC_MAX"
                  placeholder="补充一句说明（选填）"
                  placeholder-class="field__ph"
                  @blur="syncToDraft"
                />

                <!-- 图文投票：每个选项最多 3 张，第一张当封面 -->
                <view v-if="imageMode" class="shots">
                  <view
                    v-for="(img, ii) in opt.images ?? []"
                    :key="img"
                    class="shot"
                    @tap="previewOptionImages(i, ii)"
                  >
                    <image class="shot__img" :src="resolveFileUrl(img)" mode="aspectFill" />
                    <view v-if="ii === 0 && (opt.images?.length ?? 0) > 1" class="shot__badge">
                      <text class="shot__badge-text">封面</text>
                    </view>
                    <view class="shot__remove" @tap.stop="removeOptionImage(i, ii)">
                      <AppIcon name="x" :size="9" color="#FFFFFF" :stroke-width="3" />
                    </view>
                  </view>

                  <view
                    v-if="(opt.images?.length ?? 0) < MAX_OPTION_IMAGES"
                    class="shot shot--add"
                    :hover-class="uploadingAt === String(i) ? 'none' : 'shot--active'"
                    @tap="addOptionImage(i)"
                  >
                    <view v-if="uploadingAt === String(i)" class="shot__spin" />
                    <AppIcon v-else name="image-plus" :size="15" color="#A1A1AA" />
                  </view>
                </view>
              </view>
              <view class="opt__handle" @tap.stop="onOptionLongPress(i)">
                <AppIcon name="grip-vertical" :size="16" color="#A1A1AA" />
              </view>
            </view>
          </view>

          <view class="add" hover-class="add--active" @tap="openAdd">
            <AppIcon name="plus" :size="16" color="#71717A" />
            <text class="add__text">添加选项</text>
          </view>
        </view>

        <!-- 回答方式预览（问卷） -->
        <view v-else class="field">
          <view class="field__head">
            <text class="field__label">回答方式</text>
            <text class="field__optional">参与者看到的样子</text>
          </view>

          <view class="preview">
            <view class="preview__top">
              <AppIcon name="message-square-text" :size="15" color="#71717A" />
              <text class="preview__label">填写你的回答</text>
            </view>
            <view class="preview__box">
              <text class="preview__ph">说说你的想法…</text>
            </view>
            <view class="preview__foot">
              <text class="preview__count">0/500</text>
              <text class="preview__hint">可跳过，不作答也能提交</text>
            </view>
          </view>

          <text class="field__note">
            问卷没有固定选项，每位参与者填写自己的回答；发起人在数据页逐条查看。
          </text>
        </view>
      </view>
    </scroll-view>

    <view class="content__actions" :style="{ paddingBottom: bottomInset(20) }">
      <view class="content__prev" hover-class="content__prev--active" @tap="goBack">
        <text class="content__prev-text">上一步</text>
      </view>
      <view
        class="content__next"
        :class="{ 'content__next--off': !canNext }"
        :hover-class="canNext ? 'content__next--active' : 'none'"
        @tap="next"
      >
        <text class="content__next-text">下一步</text>
      </view>
    </view>

    <!-- 33 添加选项：标题行右侧是 28 的关闭钮，底部是 48 高的取消/添加 -->
    <AppSheet
      :visible="sheetVisible"
      title="添加选项"
      @close="sheetVisible = false"
    >
      <template #head-extra>
        <view class="sheet-close" @tap="sheetVisible = false">
          <AppIcon name="x" :size="14" color="#71717A" />
        </view>
      </template>

      <view class="sheet-form">
        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项标题</text>
            <text class="sheet-form__count">{{ charCount(newTitle) }}/{{ OPTION_MAX }}</text>
          </view>
          <view class="sheet-form__input" :class="{ 'sheet-form__input--focus': newTitle }">
            <input
              v-model="newTitle"
              :maxlength="OPTION_MAX"
              placeholder="例如：烧烤晚餐"
              placeholder-class="field__ph"
            />
          </view>
        </view>

        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项说明</text>
            <text class="sheet-form__count">选填</text>
          </view>
          <view class="sheet-form__input">
            <input
              v-model="newDesc"
              :maxlength="OPTION_DESC_MAX"
              placeholder="补充一句说明，帮助参与者判断"
              placeholder-class="field__ph"
            />
          </view>
        </view>

        <view v-if="imageMode" class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项配图</text>
            <text class="sheet-form__count">最多 {{ MAX_OPTION_IMAGES }} 张 · 第一张为封面</text>
          </view>

          <view class="shots">
            <view
              v-for="(img, ii) in newImages"
              :key="img"
              class="shot"
              @tap="previewSheetImages(ii)"
            >
              <image class="shot__img" :src="resolveFileUrl(img)" mode="aspectFill" />
              <view v-if="ii === 0 && newImages.length > 1" class="shot__badge">
                <text class="shot__badge-text">封面</text>
              </view>
              <view class="shot__remove" @tap.stop="removeSheetImage(ii)">
                <AppIcon name="x" :size="9" color="#FFFFFF" :stroke-width="3" />
              </view>
            </view>

            <view
              v-if="newImages.length < MAX_OPTION_IMAGES"
              class="shot shot--add"
              :hover-class="uploadingAt === 'sheet' ? 'none' : 'shot--active'"
              @tap="addSheetImage"
            >
              <view v-if="uploadingAt === 'sheet'" class="shot__spin" />
              <AppIcon v-else name="image-plus" :size="15" color="#A1A1AA" />
            </view>
          </view>
        </view>
      </view>

      <view class="sheet-tip">
        <AppIcon name="info" :size="12" color="#A1A1AA" />
        <text class="sheet-tip__text">添加后可长按拖拽调整顺序</text>
      </view>

      <template #footer>
        <view class="sheet-actions">
          <AppButton type="outline" size="inline" class="sheet-actions__btn" @tap="sheetVisible = false">
            取消
          </AppButton>
          <AppButton size="inline" class="sheet-actions__btn" :disabled="!newTitle.trim()" @tap="confirmAdd">
            添加
          </AppButton>
        </view>
      </template>
    </AppSheet>

    <AppActionSheet
      :visible="optionMenuVisible"
      title="选项操作"
      :desc="optionMenuIndex >= 0 ? draft.draft.options[optionMenuIndex]?.title : ''"
      :items="optionMenuItems"
      @close="optionMenuVisible = false"
      @select="onOptionAction"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'CreateContentPage' }
</script>

<style lang="scss" scoped>
.content {
  /*
   * 这里必须是定高而不是 min-height：容器高度 auto 时，里面的 scroll-view
   * （flex: 1; height: 0）会被内容撑开，结果是整页在滚、底部操作栏跟着跑。
   * 定成 100vh 后滚动交给 scroll-view，导航栏、步骤条、操作栏三块才是固定的。
   */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__cancel {
    font-size: $fs-14;
    color: $muted;
  }

  &__nav-title {
    font-size: $fs-16;
    font-weight: 600;
    color: $ink;
  }

  &__draft {
    padding: 5px 10px;
    border-radius: $r-chip;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__draft-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent;
  }

  /*
   * 步骤条：和导航栏一起固定在顶部，不进 scroll-view。
   * 放在滚动容器外面比 sticky 稳 —— 小程序里 sticky 在 scroll-view 内并不可靠。
   * 背景铺 $bg，滚动时内容不会从它两侧透出来。
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
    border-radius: $r-input;
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
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }

  &__next {
    flex: 1;
    height: 52px;
    border-radius: $r-button;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 能不能下一步只差透明度，渐隐比直接变灰更清楚 */
    transition: opacity $dur-fast $ease-both;

    &--off {
      opacity: 0.4;
    }

    &--active {
      opacity: 0.85;
    }
  }

  &__next-text {
    font-size: $fs-16;
    font-weight: 700;
    color: $white;
  }
}

/* 字段通用 */
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__optional {
    font-size: $fs-11;
    color: $faint;
  }

  &__link {
    font-size: $fs-11;
    color: $accent-ink;
  }

  /* 29/33：输入框是 14 圆角、内边距 14 的白卡（聚焦时 2px 描边，用内阴影补足） */
  &__input {
    padding: 14px;
    border-radius: $r-input;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    transition:
      border-color $dur-fast $ease-both,
      box-shadow $dur-fast $ease-both;

    &--focus {
      border-color: $accent;
      box-shadow: inset 0 0 0 1px $accent;
    }
  }

  &__input-inner {
    flex: 1;
    font-size: $fs-15;
    color: $ink;
    line-height: 1.4;
  }

  &__textarea {
    height: 76px;
    padding: 14px;
    border-radius: $r-input;
    background: $surface;
    border: 1px solid $line;
    transition:
      border-color $dur-fast $ease-both,
      box-shadow $dur-fast $ease-both;
  }

  &__textarea-inner {
    width: 100%;
    height: 100%;
    font-size: $fs-12;
    color: $ink;
    line-height: 1.55;
  }

  &__ph {
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;

    &--end {
      justify-content: flex-end;
    }
  }

  &__hint,
  &__count {
    font-size: $fs-11;
    color: $faint;
  }

  &__note {
    font-size: $fs-11;
    color: $faint;
    line-height: 1.55;
    padding-top: 2px;
  }
}

/* 选项列表 */
.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opt {
  padding: 11px 13px;
  border-radius: $r-md;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &__index {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__index-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $muted;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title-input {
    font-size: $fs-14;
    font-weight: 500;
    color: $ink;
  }

  &__desc-input {
    font-size: $fs-11;
    color: $muted;
  }

  &__handle {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}

/*
 * 选项配图：44 的方图，最多 3 张 + 一个加号位。
 * 放在文字下面而不是左侧 —— 一行里已经有序号、两个输入框和拖拽手柄，
 * 再挤一列 44 的图，标题就只剩十来个字可写了。
 */
.shots {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}

.shot {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: $r-sm;
  overflow: hidden;
  background: $subtle;
  flex-shrink: 0;

  &__img {
    width: 100%;
    height: 100%;
    display: block;
  }

  &--add {
    border: 1px dashed $line;
    background: $surface;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color $dur-fast $ease-both;
  }

  &--active {
    background: $subtle;
  }

  /* 右上角删除：压一层半透明黑底，白色 × 才看得清 */
  &__remove {
    position: absolute;
    top: 0;
    right: 0;
    width: 16px;
    height: 16px;
    border-bottom-left-radius: $r-xs;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 封面角标：左下角，小一号 */
  &__badge {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 1px 4px;
    border-top-right-radius: $r-xs;
    background: rgba(0, 0, 0, 0.55);
  }

  &__badge-text {
    font-size: 8px;
    line-height: 1.2;
    color: $white;
  }

  /* 上传中的转圈：不引组件，14 的圆环足够 */
  &__spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid $line;
    border-top-color: $accent;
    animation: shot-spin 0.7s linear infinite;
  }
}

@keyframes shot-spin {
  to {
    transform: rotate(360deg);
  }
}

.add {
  height: 44px;
  border-radius: $r-md;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    background-color $dur-fast $ease-both,
    border-color $dur-fast $ease-both;

  &--active {
    background: $subtle;
    border-color: $line;
  }

  &__text {
    font-size: $fs-13;
    color: $muted;
  }
}

.from-survey {
  padding: 10px 12px;
  border-radius: $r-sm;
  background: $accent-soft;

  &__text {
    font-size: $fs-11;
    color: $accent-ink;
    line-height: 1.5;
  }
}

/* 问卷回答方式预览（93）：r14 pad14 gap10，内层 96 高灰框 */
.preview {
  padding: 14px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__label {
    font-size: $fs-11;
    color: $muted;
  }

  &__box {
    height: 96px;
    padding: 12px;
    border-radius: $r-sm;
    background: $bg;
  }

  &__ph {
    font-size: $fs-13;
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__count,
  &__hint {
    font-size: $fs-11;
    color: $faint;
  }
}

/* 添加选项弹层 */
.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: $fs-12;
    font-weight: 600;
    color: $ink;
  }

  &__count {
    font-size: $fs-10;
    color: $faint;
  }

  /* 33：白底 + 1px $line，12 圆角，内边距 12 */
  &__input {
    padding: 12px;
    border-radius: $r-md;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    font-size: $fs-13;
    color: $ink;
    transition:
      border-color $dur-fast $ease-both,
      box-shadow $dur-fast $ease-both;

    &--focus {
      border-color: $accent;
      box-shadow: inset 0 0 0 1px $accent;
    }
  }
}

/* 33 的关闭钮：28 圆、$subtle 底 */
.sheet-close {
  width: 28px;
  height: 28px;
  border-radius: $r-input;
  background: $subtle;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/*
 * 33 的提示行：12 号图标 + 10 号灰字。
 * 弹层 body 是普通 view，没有 gap —— 间距得自己给，否则会紧贴上面的输入框。
 * 12 比表单内部的 14 略小一号：它是脚注，不该和表单字段抢同一档层级。
 */
.sheet-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;

  &__text {
    font-size: $fs-10;
    color: $faint;
  }
}

.sheet-actions {
  display: flex;
  align-items: center;
  gap: 10px;

  &__btn {
    flex: 1;
  }
}
</style>
