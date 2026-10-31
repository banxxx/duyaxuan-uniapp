<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, updatePoll, uploadPollImage } from '@/api/poll'
import { resolveFileUrl } from '@/utils/api-base'
import { charCount } from '@/utils/format'
import { MAX_OPTION_IMAGES, chooseImage } from '@/utils/image'
import { bottomInset } from '@/utils/platform'
import { ROUTES, back, go } from '@/utils/router'
import { cacheDrop, cacheKey } from '@/utils/cache'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 90 编辑投票 · 内容 / 93 编辑问卷 · 内容
 *
 * 这一页只管「内容和选项」，规则（匿名、参与方式、截止时间等）在 edit-rules，
 * 通过底部的「规则设置」进入，两页分开保存。
 *
 * 可编辑范围（和后端 updatePoll 的限制一一对应）：
 *   主题 / 说明：随时可改
 *   选项：已有票数的连文字都不能改；没票的可以改、可以删；进行中还能新增
 *   已结束：选项全部锁定，只剩主题 / 说明
 *
 * 导航是「关闭 / 编辑投票 | 编辑问卷 / 已发布」，顶部带一条已发布/已截止的提示。
 */
const poll = ref<Poll | null>(null)
const loading = ref(true)
/** 首屏加载失败：给错误页和重试，不要停在空白页 */
const loadError = ref(false)
const saving = ref(false)

const title = ref('')
const desc = ref('')
const options = ref<
  Array<{
    id?: string
    title: string
    desc?: string
    images?: string[]
    votes?: number
    locked?: boolean
  }>
>([])

/**
 * 图文投票：加载时任意一个选项带图就进入配图模式。
 *
 * 没有 poll 级的类型字段 —— 图文投票就是「单选/多选 + 选项带图」，
 * 从数据本身推出来比多存一列更难对不上。
 */
const imageMode = ref(false)

const pollId = ref('')

/** 添加选项弹层 */
const sheetVisible = ref(false)
const newTitle = ref('')
const newDesc = ref('')
/** 弹层里先攒着、点「添加」才落到选项上的图 */
const newImages = ref<string[]>([])
/** 正在上传的图位：选项下标（字符串）或 'sheet'，null 表示空闲 */
const uploadingAt = ref<string | null>(null)

const TITLE_MAX = 60
const DESC_MAX = 200
const OPTION_MAX = 30

const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

const responseCount = computed(() =>
  isSurvey.value ? poll.value?.answerCount ?? 0 : poll.value?.voterCount ?? 0
)

const hasResponses = computed(() => responseCount.value > 0)

const publishedDays = computed(() => {
  if (!poll.value) return 0
  return Math.max(1, Math.floor((Date.now() - poll.value.createdAt) / 86400000))
})

const publishedText = computed(() => {
  if (!poll.value) return ''
  const tail = isEnded.value ? ' · 已截止' : ''
  if (isSurvey.value) {
    return `已收集 ${publishedDays.value} 天 · ${responseCount.value} 条回答${tail}`
  }
  return `已发布 ${publishedDays.value} 天 · ${responseCount.value} 人已投票${tail}`
})

/** 锁定提示：哪些东西已经不能改（和编辑规则页的分层锁定保持一致） */
const lockNote = computed(() => {
  if (isEnded.value) {
    return `${isSurvey.value ? '问卷' : '投票'}已结束，选项和规则已全部锁定，现在只能修改主题和说明。`
  }
  if (!hasResponses.value) {
    return isSurvey.value
      ? '还没有人提交，主题和说明可以修改；回答方式创建后不可修改。'
      : '还没有人投票，主题、说明和选项都可以修改；投票类型创建后不可修改。'
  }
  return isSurvey.value
    ? '主题和说明可随时修改，已提交的回答不受影响；回答方式已锁定。'
    : '主题和说明可随时修改；已有票数的选项已锁定，没人投过的选项还可以改或删除。'
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p
    title.value = p.title
    desc.value = p.desc ?? ''
    options.value = p.options.map((o) => ({
      id: o.id,
      title: o.title,
      desc: o.desc,
      images: o.images,
      votes: o.votes,
      locked: o.votes > 0
    }))
    imageMode.value = p.options.some((o) => !!o.images?.length)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

function openAdd() {
  if (isEnded.value) {
    toast.show('已结束，不能再添加选项')
    return
  }
  if (options.value.length >= 12) {
    toast.show('最多 12 个选项')
    return
  }
  newTitle.value = ''
  newDesc.value = ''
  newImages.value = []
  sheetVisible.value = true
}

/** 幂等：小程序自定义组件内部 tap 会穿出组件边界，和 emit('tap') 叠加触发两次 */
let adding = false

function confirmAdd() {
  if (adding) return
  const t = newTitle.value.trim()
  if (!t) return
  adding = true
  options.value.push({
    title: t,
    desc: newDesc.value.trim() || undefined,
    images: newImages.value.length ? [...newImages.value] : undefined,
    votes: 0
  })
  sheetVisible.value = false
  newTitle.value = ''
  newDesc.value = ''
  newImages.value = []
  setTimeout(() => {
    adding = false
  }, 300)
}

/* ---------------- 选项配图（图文投票） ---------------- */

/** 选图 + 上传，返回服务端相对地址；取消或失败返回 null */
async function pickAndUpload(at: string): Promise<string | null> {
  if (uploadingAt.value) return null

  let path: string | null = null
  try {
    path = await chooseImage()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : '选择图片失败')
    return null
  }
  if (!path) return null

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
  const opt = options.value[index]
  if (!opt) return
  if (isEnded.value || opt.locked) {
    toast.show(isEnded.value ? '已结束，不能再改选项' : `已有 ${opt.votes} 票，不能改配图`)
    return
  }
  if ((opt.images?.length ?? 0) >= MAX_OPTION_IMAGES) {
    toast.show(`最多 ${MAX_OPTION_IMAGES} 张图`)
    return
  }

  const url = await pickAndUpload(String(index))
  if (!url) return
  // 上传期间这一项可能被删掉或挪过位置，按对象引用重新确认一次
  if (!options.value.includes(opt)) return
  opt.images = [...(opt.images ?? []), url]
}

function removeOptionImage(index: number, imgIndex: number) {
  const opt = options.value[index]
  if (!opt?.images) return
  if (isEnded.value || opt.locked) return
  opt.images = opt.images.filter((_, i) => i !== imgIndex)
}

function previewImages(list: string[], imgIndex: number) {
  const urls = list.map(resolveFileUrl)
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

function removeOption(i: number) {
  const opt = options.value[i]
  if (isEnded.value) {
    toast.show('已结束，不能再删除选项')
    return
  }
  if (opt.locked) {
    toast.show(`已有 ${opt.votes} 票，不能删除`)
    return
  }
  options.value.splice(i, 1)
}

async function save() {
  if (!poll.value) return
  if (!title.value.trim()) {
    toast.show(`先填${isSurvey.value ? '问卷' : '投票'}主题`)
    return
  }
  if (!isSurvey.value && options.value.length < 2) {
    toast.show('至少保留 2 个选项')
    return
  }

  saving.value = true
  try {
    // 已结束：选项和规则都已锁定，只提交主题/说明，避免带上未改动的字段被后端判成越权修改
    const body: Parameters<typeof updatePoll>[1] = {
      title: title.value.trim(),
      desc: desc.value.trim()
    }
    if (!isEnded.value) {
      body.type = poll.value.type
      body.options = options.value.map((o) => ({
        id: o.id,
        title: o.title.trim(),
        desc: o.desc,
        images: o.images?.length ? o.images : undefined,
        votes: o.votes
      }))
    }
    const next = await updatePoll(poll.value.id, body)
    poll.value = next
    // 改过内容，这条投票的所有快照作废：标题、选项都变了，不能先显示旧的
    cacheDrop(cacheKey.pollAll(poll.value.id))
    toast.success('已保存')
    setTimeout(back, 600)
  } catch {
    // 失败原因由请求层统一 toast，这里不再重复
  } finally {
    saving.value = false
  }
}

function close() {
  back()
}

function goRules() {
  go(ROUTES.creatorEditRules, { id: pollId.value })
}
</script>

<template>
  <view class="edit">
    <AppToast />
    <AppNavBar :back="false">
      <template #left>
        <text class="edit__close" @tap="close">关闭</text>
      </template>
      <template #title>
        <text class="edit__nav-title">编辑{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="edit__status" :class="{ 'edit__status--ended': isEnded }">
          <text class="edit__status-text" :class="{ 'edit__status-text--ended': isEnded }">
            {{ isEnded ? '已结束' : '已发布' }}
          </text>
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="edit__body">
      <AppSkeleton type="detail" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，或者这条投票已经被删除"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <scroll-view v-else-if="poll" class="edit__scroll" scroll-y>
      <view class="edit__inner">
        <!-- 已发布提示条：图标 + 两行文案，r12 pad[12,14] gap10 -->
        <view class="notice">
          <AppIcon name="triangle-alert" :size="16" color="#B45309" />
          <view class="notice__text">
            <text class="notice__title">{{ publishedText }}</text>
            <text class="notice__desc">{{ lockNote }}</text>
          </view>
        </view>

        <!-- 主题 -->
        <view class="field">
          <text class="field__label">{{ isSurvey ? '问卷主题' : '投票主题' }}</text>
          <view class="field__input" :class="{ 'field__input--focus': title }">
            <input
              v-model="title"
              class="field__input-inner"
              :maxlength="TITLE_MAX"
              placeholder="建议 20 字以内，说明清楚"
              placeholder-class="field__ph"
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
              placeholder="补充背景、规则或预算，帮助参与者判断"
              placeholder-class="field__ph"
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
            <text class="field__optional">
              {{ isEnded ? '已结束 · 全部锁定' : '有票数的选项已锁定' }}
            </text>
          </view>

          <view class="options">
            <view
              v-for="(opt, i) in options"
              :key="opt.id ?? `new-${i}`"
              class="opt"
              :class="{ 'opt--locked': opt.locked || isEnded }"
            >
              <view class="opt__index">
                <text class="opt__index-text">{{ i + 1 }}</text>
              </view>

              <view class="opt__text">
                <input
                  v-model="opt.title"
                  class="opt__title-input"
                  :class="{ 'opt__input--locked': opt.locked || isEnded }"
                  :disabled="opt.locked || isEnded"
                  :maxlength="OPTION_MAX"
                  placeholder="选项标题"
                  placeholder-class="field__ph"
                />
                <input
                  v-model="opt.desc"
                  class="opt__desc-input"
                  :class="{ 'opt__input--locked': opt.locked || isEnded }"
                  :disabled="opt.locked || isEnded"
                  :maxlength="40"
                  placeholder="补充一句说明（选填）"
                  placeholder-class="field__ph"
                />

                <!-- 图文投票：有票的选项连图一起锁住 -->
                <view
                  v-if="imageMode && ((opt.images?.length ?? 0) > 0 || (!opt.locked && !isEnded))"
                  class="shots"
                >
                  <view
                    v-for="(img, ii) in opt.images ?? []"
                    :key="img"
                    class="shot"
                    @tap="previewImages(opt.images ?? [], ii)"
                  >
                    <image class="shot__img" :src="resolveFileUrl(img)" mode="aspectFill" />
                    <view v-if="ii === 0 && (opt.images?.length ?? 0) > 1" class="shot__badge">
                      <text class="shot__badge-text">封面</text>
                    </view>
                    <view
                      v-if="!opt.locked && !isEnded"
                      class="shot__remove"
                      @tap.stop="removeOptionImage(i, ii)"
                    >
                      <AppIcon name="x" :size="9" color="#FFFFFF" :stroke-width="3" />
                    </view>
                  </view>

                  <view
                    v-if="!opt.locked && !isEnded && (opt.images?.length ?? 0) < MAX_OPTION_IMAGES"
                    class="shot shot--add"
                    :hover-class="uploadingAt === String(i) ? 'none' : 'shot--active'"
                    @tap="addOptionImage(i)"
                  >
                    <view v-if="uploadingAt === String(i)" class="shot__spin" />
                    <AppIcon v-else name="image-plus" :size="15" color="#A1A1AA" />
                  </view>
                </view>
              </view>

              <view v-if="opt.locked || isEnded" class="opt__votes">
                <text class="opt__votes-text">{{ opt.votes }} 票</text>
              </view>
              <view v-else class="opt__remove" @tap="removeOption(i)">
                <AppIcon name="x" :size="14" color="#A1A1AA" />
              </view>
            </view>
          </view>

          <view v-if="!isEnded" class="add" hover-class="add--active" @tap="openAdd">
            <AppIcon name="plus" :size="16" color="#71717A" />
            <text class="add__text">添加选项（不计入已有票数）</text>
          </view>
        </view>

        <!-- 回答方式（问卷，已锁定） -->
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

          <text class="edit__lock-note">
            回答框写法和字数上限创建后不可修改，已提交的回答不会受影响。
          </text>
        </view>

        <!-- 内容页只改文字和选项；匿名、参与方式、截止时间在规则页，分开保存 -->
        <view class="rules-link" hover-class="rules-link--active" @tap="goRules">
          <view class="rules-link__text">
            <text class="rules-link__title">规则设置</text>
            <text class="rules-link__desc">
              {{ isEnded ? '已结束，规则不可再修改' : '匿名、参与方式、截止时间、结果可见性' }}
            </text>
          </view>
          <AppIcon name="chevron-right" :size="16" color="#A1A1AA" />
        </view>
      </view>
    </scroll-view>

    <view v-if="poll" class="edit__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton type="subtle" size="action" :radius="14" class="edit__action" @tap="close">取消</AppButton>
      <AppButton size="submit" :loading="saving" class="edit__action" @tap="save">保存修改</AppButton>
    </view>

    <AppSheet :visible="sheetVisible" title="添加选项" @close="sheetVisible = false">
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
            <input v-model="newTitle" :maxlength="OPTION_MAX" placeholder="例如：烧烤晚餐" placeholder-class="field__ph" />
          </view>
        </view>

        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项说明</text>
            <text class="sheet-form__count">选填</text>
          </view>
          <view class="sheet-form__input">
            <input v-model="newDesc" :maxlength="40" placeholder="补充一句说明" placeholder-class="field__ph" />
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
              @tap="previewImages(newImages, ii)"
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
        <text class="sheet-tip__text">新选项从 0 票起算，不计入已有票数</text>
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
  </view>
</template>

<script lang="ts">
export default { name: 'EditContentPage' }
</script>

<style lang="scss" scoped>
.edit {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__close {
    font-size: $fs-14;
    color: $muted;
  }

  &__nav-title {
    font-size: $fs-16;
    font-weight: 600;
    color: $ink;
  }

  /* 已发布标记：浅紫胶囊，11/600 */
  &__status {
    padding: 5px 10px;
    border-radius: $r-chip;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__status-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent;
  }

  /* 已结束不再用「已发布」的紫标，改成中性灰 */
  &__status--ended {
    background: $subtle;
  }

  &__status-text--ended {
    color: $faint;
  }

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__inner {
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 90/93：底部两个等宽按钮，取消是 14 圆角白底，保存是 16 圆角紫底 16/700 */
  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__action {
    flex: 1;
  }

  /* 93 的锁定说明是纯文字，不是灰底卡 */
  &__lock-note {
    font-size: $fs-11;
    color: $faint;
    line-height: 1.55;
  }
}

/* 提示条：r12 pad[12,14] gap10，图标与两行文案并排 */
.notice {
  padding: 12px 14px;
  border-radius: $r-md;
  background: $warning-soft;
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: $fs-12;
    font-weight: 600;
    color: $warning;
  }

  &__desc {
    font-size: $fs-11;
    color: $muted;
    line-height: 1.5;
  }
}

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

  &__input {
    padding: 14px;
    border-radius: $r-input;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;

    /* 设计稿聚焦态是 2px 描边；用内阴影补足 1px，避免边框变粗带来位移 */
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
}

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

  /* 有票数 / 已结束：输入框只读，视觉上退成正文色，避免看起来还能点 */
  &__input--locked {
    color: $muted;
    opacity: 1;
    -webkit-text-fill-color: $muted;
  }

  &__votes {
    height: 22px;
    padding: 0 8px;
    border-radius: $r-xs;
    background: $subtle;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__votes-text {
    font-size: $fs-10;
    font-weight: 600;
    color: $faint;
  }

  &__remove {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}

/* 选项配图：和创建页同一套 44 方图 + 加号位 */
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

  &--active {
    background: $subtle;
  }

  &__text {
    font-size: $fs-13;
    color: $muted;
  }
}

/* 规则设置入口：和 33 的卡片同款描边，右侧箭头表示会进下一页 */
.rules-link {
  padding: 14px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &--active {
    background: $subtle;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: $fs-14;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }
}

/* 93 的回答方式预览：r14 pad14 gap10，内层 96 高灰框 */
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
