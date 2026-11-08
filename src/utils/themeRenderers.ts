import { alpha } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Post, SiteConfig, PostCardThemeConfig, ThemeParamSchema, ThemeParamOption } from '@/types';

export interface PostCardRenderContext {
  post: Post;
  config: SiteConfig;
  themeColor: string;
  borderRadius: number;
}

export interface PostCardRenderOutput {
  layout: 'overlay' | 'clean';
  mediaAsBackground?: boolean;
  root?: SxProps<Theme>;
  media?: SxProps<Theme>;
  overlay?: SxProps<Theme>;
  content?: SxProps<Theme>;
  tag?: SxProps<Theme>;
  title?: SxProps<Theme>;
  excerpt?: SxProps<Theme>;
  meta?: SxProps<Theme>;
  action?: SxProps<Theme>;
  book?: {
    root?: SxProps<Theme>;
    base?: SxProps<Theme>;
    cover?: SxProps<Theme>;
  };
}

export interface PostCardRenderer<P = Record<string, unknown>> {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
  defaultParams: P;
  schema: ThemeParamSchema[];
  render: (params: P, context: PostCardRenderContext) => PostCardRenderOutput;
}

const textPositionOptions: ThemeParamOption[] = [
  { value: 'bottom-left', label: '左下角' },
  { value: 'bottom-center', label: '底部居中' },
  { value: 'bottom-right', label: '右下角' },
];

const titleSizeOptions: ThemeParamOption[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

function titleSizeValue(size?: string): string {
  if (!size || size === 'medium') return '1.25rem';
  if (size === 'small') return '1rem';
  if (size === 'large') return '1.5rem';
  return size;
}

function isEmptyColor(v?: string): boolean {
  if (!v) return true;
  const s = v.trim().toLowerCase();
  return ['#000', '#000000', '000000', '000', 'rgb(0,0,0)', 'rgba(0,0,0,0)', 'transparent'].includes(s);
}

function resolveColor(value: string | undefined, fallback: string): string {
  
  return isEmptyColor(value) ? fallback : (value as string);
}

function resolveBorderColor(params: { borderColor?: string }, themeColor: string): string {
  return resolveColor(params.borderColor, themeColor || '#5b7cfa');
}

function resolveBorderRadius(params: { borderRadius?: number }, siteRadius: number): number {
  return params.borderRadius ?? siteRadius ?? 16;
}

function applyParamsToStyles<T>(styles: T, params: Record<string, unknown>): T {
  if (typeof styles === 'string') {
    return styles.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, key) => {
      const v = params[key];
      return v !== undefined ? String(v) : `{{${key}}}`;
    }) as unknown as T;
  }
  if (Array.isArray(styles)) {
    return styles.map((item) => applyParamsToStyles(item, params)) as unknown as T;
  }
  if (styles && typeof styles === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(styles)) {
      result[k] = applyParamsToStyles(v, params);
    }
    return result as T;
  }
  return styles;
}

export function renderCloudCardStyles(
  theme: PostCardThemeConfig,
  context: PostCardRenderContext
): PostCardRenderOutput {
  const layout = theme.layout === 'overlay' ? 'overlay' : 'clean';
  const styleParams = {
    themeColor: context.themeColor,
    borderRadius: context.borderRadius,
    ...(theme.params || {}),
  };
  const resolved = theme.styles ? applyParamsToStyles(theme.styles, styleParams) : {};
  const output: PostCardRenderOutput = {
    layout,
    mediaAsBackground: layout === 'overlay',
    ...resolved,
  };
  if (layout === 'overlay' && !output.media) {
    output.media = {
      position: 'absolute',
      inset: 0,
      zIndex: 0,
      backgroundImage: context.post.cover ? `url(${context.post.cover})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return output;
}

export function buildPostCardOutput(
  theme: PostCardThemeConfig,
  context: PostCardRenderContext
): PostCardRenderOutput | null {
  const renderer = getPostCardRenderer(theme.variant);
  const styleParams = {
    themeColor: context.themeColor,
    borderRadius: context.borderRadius,
    ...(theme.params || {}),
  };
  let output: PostCardRenderOutput;
  if (renderer) {
    
    const params = { ...renderer.defaultParams, ...(theme.params || {}), ...theme };
    output = renderer.render(params, context);
    if (theme.styles) {
      output = {
        ...output,
        ...applyParamsToStyles(theme.styles, styleParams),
      };
    }
  } else if (theme.styles) {
    output = renderCloudCardStyles(theme, context);
  } else {
    return null;
  }
  return output;
}

export const overlayCardRenderer: PostCardRenderer<{
  borderWidth: number;
  borderRadius: number;
  borderColor: string;
  backgroundColor: string;
  titleSize: 'small' | 'medium' | 'large';
  textPosition: 'bottom-left' | 'bottom-center' | 'bottom-right';
  textColor: string;
  showExcerpt: boolean;
  showTags: boolean;
  showMeta: boolean;
  fillSolidBg: boolean;
}> = {
  id: 'overlay-card',
  name: '叠加画报',
  description: '以文章封面作为背景，底部叠加文字的画报风格卡片。',
  aliases: ['border-image'],
  defaultParams: {
    borderWidth: 4,
    borderRadius: 24,
    borderColor: '',
    backgroundColor: '',
    titleSize: 'large',
    textPosition: 'bottom-left',
    textColor: '#ffffff',
    showExcerpt: true,
    showTags: true,
    showMeta: true,
    fillSolidBg: true,
  },
  schema: [
    { key: 'borderWidth', label: '边框宽度', type: 'number', min: 0, max: 12, step: 1 },
    { key: 'textPosition', label: '文字位置', type: 'select', options: textPositionOptions },
    { key: 'titleSize', label: '标题大小', type: 'select', options: titleSizeOptions },
    { key: 'showExcerpt', label: '显示摘要', type: 'boolean' },
    { key: 'showTags', label: '显示分类', type: 'boolean' },
    { key: 'showMeta', label: '显示阅读时间等元信息', type: 'boolean' },
    { key: 'fillSolidBg', label: '无封面时填充纯色背景', type: 'boolean' },
  ],
  render: (params, { post, config, themeColor }) => {
    const borderColor = resolveBorderColor(params, themeColor);
    const borderRadius = resolveBorderRadius(params, config.theme?.borderRadius ?? 16);
    const alignItems =
      params.textPosition === 'bottom-center'
        ? 'center'
        : params.textPosition === 'bottom-right'
          ? 'flex-end'
          : 'flex-start';
    const textAlign =
      params.textPosition === 'bottom-center'
        ? 'center'
        : params.textPosition === 'bottom-right'
          ? 'right'
          : 'left';
    
    const hasCover = !!post.cover;
    const fillSolidBg = params.fillSolidBg !== false;
    const rootBg = hasCover
      ? resolveColor(params.backgroundColor, alpha(themeColor, 0.1))
      : fillSolidBg
        ? themeColor
        : resolveColor(params.backgroundColor, alpha(themeColor, 0.1));

    return {
      layout: 'overlay',
      mediaAsBackground: true,
      root: {
        position: 'relative',
        height: { xs: 260, sm: 300, md: 340 },
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: `${borderRadius}px`,
        border: `${params.borderWidth}px solid ${borderColor}`,
        backgroundColor: rootBg,
        transition: 'box-shadow 0.2s ease',
        '@media (hover: hover) and (pointer: fine)': {
          '&:hover': {
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? `0 8px 30px ${alpha(borderColor, 0.25)}`
                : `0 8px 30px ${alpha(theme.palette.common.black, 0.35)}`,
          },
        },
      },
      media: {
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        backgroundImage: post.cover ? `url(${post.cover})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      },
      overlay: {
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        background: (theme) =>
          `linear-gradient(to top, ${alpha(theme.palette.common.black, 0.72)} 0%, ${alpha(
            theme.palette.common.black,
            0.2
          )} 50%, ${alpha(theme.palette.common.black, 0)} 100%)`,
      },
      content: {
        position: 'relative',
        zIndex: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems,
        textAlign,
        p: { xs: 2, sm: 3 },
      },
      tag: {
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.2),
        color: 'common.white',
        fontWeight: 500,
        backdropFilter: 'blur(4px)',
      },
      title: {
        fontWeight: 700,
        mb: params.showExcerpt ? 1 : 0,
        lineHeight: 1.3,
        fontSize: titleSizeValue(params.titleSize),
        overflowWrap: 'break-word',
        color: params.textColor || 'common.white',
        textShadow: '0 2px 8px rgba(0,0,0,0.4)',
      },
      excerpt: {
        mb: params.showMeta ? 1.5 : 0,
        lineHeight: 1.6,
        fontSize: { xs: '0.875rem', sm: '0.9375rem' },
        overflowWrap: 'break-word',
        color: 'rgba(255,255,255,0.85)',
        textShadow: '0 1px 4px rgba(0,0,0,0.4)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      meta: {
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        color: 'rgba(255,255,255,0.75)',
        typography: 'caption',
        justifyContent: alignItems,
      },
    };
  },
};

export const cleanCardRenderer: PostCardRenderer<{
  borderWidth: number;
  borderRadius: number;
  borderColor: string;
  backgroundColor: string;
  titleSize: 'small' | 'medium' | 'large';
  showExcerpt: boolean;
  showTags: boolean;
  showMeta: boolean;
}> = {
  id: 'clean-card',
  name: '简洁卡片',
  description: '顶部展示封面，下方展示文字信息的经典卡片布局。',
  defaultParams: {
    borderWidth: 0,
    borderRadius: 16,
    borderColor: '',
    backgroundColor: '',
    titleSize: 'medium',
    showExcerpt: true,
    showTags: true,
    showMeta: true,
  },
  schema: [
    { key: 'borderWidth', label: '边框宽度', type: 'number', min: 0, max: 12, step: 1 },
    { key: 'titleSize', label: '标题大小', type: 'select', options: titleSizeOptions },
    { key: 'showExcerpt', label: '显示摘要', type: 'boolean' },
    { key: 'showTags', label: '显示分类', type: 'boolean' },
    { key: 'showMeta', label: '显示阅读时间等元信息', type: 'boolean' },
  ],
  render: (params, { config, themeColor }) => {
    const borderRadius = resolveBorderRadius(params, config.theme?.borderRadius ?? 16);

    return {
      layout: 'clean',
      mediaAsBackground: false,
      root: {
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: { xs: 340, sm: 380 },
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: `${borderRadius}px`,
        border: `${params.borderWidth}px solid transparent`,
        backgroundColor: 'background.paper',
        boxShadow: (theme) =>
          theme.palette.mode === 'light'
            ? '0 1px 2px 0 rgba(0,0,0,0.05)'
            : '0 1px 2px 0 rgba(0,0,0,0.4)',
        transition: 'box-shadow 0.2s ease',
        '@media (hover: hover) and (pointer: fine)': {
          '&:hover': {
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? '0 6px 20px rgba(0,0,0,0.10)'
                : '0 6px 20px rgba(0,0,0,0.45)',
          },
        },
      },
      media: {
        width: '100%',
        height: { xs: 150, sm: 160, md: 180 },
        flexShrink: 0,
        backgroundColor: (theme) =>
          theme.palette.mode === 'light' ? alpha(themeColor, 0.12) : alpha(themeColor, 0.22),
        borderRadius: () => `${borderRadius}px ${borderRadius}px 0 0`,
        overflow: 'hidden',
        '& img': {
          transition: 'transform 0.3s ease',
        },
      },
      content: {
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 1.75, sm: 2.25 },
      },
      tag: {
        backgroundColor: (theme) =>
          alpha(theme.palette.primary.main, theme.palette.mode === 'light' ? 0.1 : 0.2),
        color: 'primary.main',
        fontWeight: 500,
      },
      title: {
        fontWeight: 700,
        mb: 1,
        lineHeight: 1.35,
        fontSize: { xs: '1.25rem', sm: '1.375rem' },
        color: 'text.primary',
        overflowWrap: 'break-word',
      },
      excerpt: {
        mt: 0.5,
        mb: 2,
        flexGrow: 1,
        lineHeight: 1.6,
        fontSize: '0.875rem',
        color: 'text.secondary',
        overflowWrap: 'break-word',
        overflow: 'hidden',
      },
      meta: {
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        color: 'text.secondary',
        typography: 'caption',
      },
      action: {
        alignSelf: 'flex-start',
        mt: 1.25,
        mb: 0.5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderRadius: 1.5,
        bgcolor: (theme) => theme.palette.primary.main,
        color: (theme) => theme.palette.primary.contrastText,
        fontSize: '0.875rem',
        lineHeight: 1.25,
        fontWeight: 500,
        '& .card-action-arrow': {
          transition: 'transform 0.3s ease',
        },
        '&:hover .card-action-arrow': {
          transform: 'translateX(4px)',
        },
      },
    };
  },
};

export const bookCardRenderer: PostCardRenderer<{
  coverColor: string;
  textColor: string;
  showExcerpt: boolean;
  showTags: boolean;
  showMeta: boolean;
}> = {
  id: 'book-card',
  name: '3D翻书',
  description: '封面如一本立体书籍：未悬停时展示封面与简介，悬停后封面翻开露出文章正文。',
  aliases: ['book'],
  defaultParams: {
    coverColor: '',
    textColor: '#ffffff',
    showExcerpt: true,
    showTags: true,
    showMeta: true,
  },
  schema: [
    { key: 'coverColor', label: '封面底色', type: 'color' },
    { key: 'textColor', label: '封面文字颜色', type: 'color' },
    { key: 'showExcerpt', label: '显示摘要', type: 'boolean' },
    { key: 'showTags', label: '显示分类', type: 'boolean' },
    { key: 'showMeta', label: '显示阅读时间等元信息', type: 'boolean' },
  ],
  render: (params, { post, config, themeColor }) => {
    const borderRadius = resolveBorderRadius(params as { borderRadius?: number }, config.theme?.borderRadius ?? 16);
    const coverColor = params.coverColor || themeColor;
    return {
      layout: 'clean',
      mediaAsBackground: false,
      root: {
        height: { xs: 300, sm: 340, md: 380 },
        minWidth: 0,
        position: 'relative',
        
        overflow: 'visible',
        borderRadius: `${borderRadius}px`,
        backgroundColor: 'background.paper',
        boxShadow: (theme) =>
          theme.palette.mode === 'light'
            ? '0 10px 28px rgba(0,0,0,0.14)'
            : '0 10px 28px rgba(0,0,0,0.45)',
        
        '&:hover': { zIndex: 2 },
      },
      book: {
        root: {
          position: 'relative',
          width: '100%',
          height: '100%',
          perspective: '2000px',
          perspectiveOrigin: '50% 50%',
          
          transformStyle: 'preserve-3d',
          
          '&:hover .bc-cover': {
            transform: 'rotateY(-80deg)',
            boxShadow: '-12px 6px 28px rgba(0,0,0,0.35)',
          },
        },
        
        base: {
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          borderRadius: `${borderRadius}px`,
          overflow: 'hidden',
          backgroundImage: post.cover
            ? `linear-gradient(135deg, ${alpha(coverColor, 0.15)}, ${alpha(coverColor, 0.6)}), url(${post.cover})`
            : `linear-gradient(135deg, ${coverColor}, ${alpha(coverColor, 0.72)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          px: 1.5,
          color: params.textColor,
        },
        
        cover: {
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          borderRadius: `${borderRadius}px`,
          overflow: 'hidden',
          transformOrigin: '0 50%',
          backgroundColor: 'background.paper',
          backfaceVisibility: 'hidden',
          willChange: 'transform',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'transform 0.6s ease, box-shadow 0.6s ease',
        },
      },
      content: {
        position: 'relative',
        zIndex: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
        p: 2,
      },
      title: { color: 'text.primary', fontWeight: 700, fontSize: '1.25rem', mb: 1, lineHeight: 1.35, overflowWrap: 'break-word' },
      excerpt: { color: 'text.secondary', mb: 1.5, lineHeight: 1.6, fontSize: '0.9rem', overflow: 'hidden', overflowWrap: 'break-word' },
      meta: { color: 'text.secondary' },
      tag: {
        backgroundColor: (theme) =>
          alpha(theme.palette.primary.main, theme.palette.mode === 'light' ? 0.1 : 0.2),
        color: 'primary.main',
        fontWeight: 500,
      },
    };
  },
};

export const newsletterCardRenderer: PostCardRenderer<{
  borderWidth: number;
  borderColor: string;
  cardRadius: number;
  showExcerpt: boolean;
  showTags: boolean;
  showMeta: boolean;
}> = {
  id: 'newsletter-card',
  name: '粗框信纸',
  description: '粗描边 + 硬投影的报刊信纸风格：悬停整卡位移并加深投影，标题下划线随悬停从左划过。',
  aliases: ['newsletter', 'retro'],
  defaultParams: {
    borderWidth: 6,
    borderColor: '',
    cardRadius: 0,
    showExcerpt: true,
    showTags: true,
    showMeta: true,
  },
  schema: [
    { key: 'borderWidth', label: '边框宽度', type: 'number', min: 0, max: 16, step: 1 },
    { key: 'cardRadius', label: '卡片圆角', type: 'number', min: 0, max: 32, step: 2 },
    { key: 'borderColor', label: '边框颜色', type: 'color' },
    { key: 'showExcerpt', label: '显示摘要', type: 'boolean' },
    { key: 'showTags', label: '显示分类', type: 'boolean' },
    { key: 'showMeta', label: '显示阅读时间等元信息', type: 'boolean' },
  ],
  render: (params, { themeColor }) => {
    const borderColor = resolveColor(params.borderColor, themeColor || '#111111');
    
    const radius = params.cardRadius ?? 0;
    
    const offset = Math.max(6, params.borderWidth * 2);
    return {
      layout: 'clean',
      mediaAsBackground: false,
      root: {
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: `${radius}px`,
        border: `${params.borderWidth}px solid ${borderColor}`,
        boxShadow: `${offset}px ${offset}px 0 ${borderColor}`,
        backgroundColor: 'background.paper',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        
        '&:hover': {
          transform: 'translate(-5px, -5px)',
          boxShadow: `${offset + 5}px ${offset + 5}px 0 ${borderColor}`,
          '& .post-card-title::after': { transform: 'translateX(0)' },
        },
      },
      media: {
        width: '100%',
        flexShrink: 0,
        backgroundColor: alpha(themeColor, 0.1),
        '& img': { transition: 'transform 0.4s ease' },
        '&:hover img': { transform: 'scale(1.04)' },
      },
      content: {
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 2, sm: 2.5 },
      },
      tag: {
        backgroundColor: (theme) =>
          alpha(theme.palette.primary.main, theme.palette.mode === 'light' ? 0.1 : 0.2),
        color: 'primary.main',
        fontWeight: 700,
        border: `2px solid ${borderColor}`,
        borderRadius: 0,
      },
      title: {
        position: 'relative',
        display: 'inline-block',
        overflow: 'hidden',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        mb: 1,
        lineHeight: 1.3,
        fontSize: { xs: '1.25rem', sm: '1.35rem' },
        color: 'text.primary',
        overflowWrap: 'break-word',
        
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '90%',
          height: 3,
          backgroundColor: borderColor,
          transform: 'translateX(-100%)',
          transition: 'transform 0.3s ease',
        },
      },
      excerpt: {
        mt: 0.5,
        mb: 2,
        flexGrow: 1,
        lineHeight: 1.6,
        fontSize: '0.9rem',
        color: 'text.secondary',
        overflowWrap: 'break-word',
        overflow: 'hidden',
      },
      meta: {
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        color: 'text.secondary',
        typography: 'caption',
        fontWeight: 600,
        '& > *': { border: 'none' },
      },
    };
  },
};

export const glassCardRenderer: PostCardRenderer<{
  borderWidth: number;
  borderRadius: number;
  borderColor: string;
  backgroundColor: string;
  overlayOpacity: number;
  glassOpacity: number;
  titleSize: 'small' | 'medium' | 'large';
  textPosition: 'bottom-left' | 'bottom-center' | 'bottom-right';
  textColor: string;
  showExcerpt: boolean;
  showTags: boolean;
  showMeta: boolean;
}> = {
  id: 'glass-card',
  name: '玻璃画报',
  description: '半透明毛玻璃质感卡片，封面作为背景，文字悬浮于磨砂渐变之上。',
  aliases: ['glass', 'glass-overlay'],
  defaultParams: {
    borderWidth: 1,
    borderRadius: 24,
    borderColor: '',
    backgroundColor: '',
    overlayOpacity: 0.6,
    glassOpacity: 0.15,
    titleSize: 'large',
    textPosition: 'bottom-left',
    textColor: '#ffffff',
    showExcerpt: true,
    showTags: true,
    showMeta: true,
  },
  schema: [
    { key: 'borderWidth', label: '边框宽度', type: 'number', min: 0, max: 8, step: 1 },
    { key: 'overlayOpacity', label: '底部渐变不透明度', type: 'number', min: 0.1, max: 1, step: 0.05 },
    { key: 'glassOpacity', label: '玻璃面板不透明度', type: 'number', min: 0, max: 0.6, step: 0.05 },
    { key: 'textPosition', label: '文字位置', type: 'select', options: textPositionOptions },
    { key: 'titleSize', label: '标题大小', type: 'select', options: titleSizeOptions },
    { key: 'showExcerpt', label: '显示摘要', type: 'boolean' },
    { key: 'showTags', label: '显示分类', type: 'boolean' },
    { key: 'showMeta', label: '显示阅读时间等元信息', type: 'boolean' },
  ],
  render: (params, { post, config, themeColor }) => {
    const borderColor = resolveBorderColor(params, themeColor);
    const borderRadius = resolveBorderRadius(params, config.theme?.borderRadius ?? 16);
    const alignItems =
      params.textPosition === 'bottom-center'
        ? 'center'
        : params.textPosition === 'bottom-right'
          ? 'flex-end'
          : 'flex-start';
    const textAlign =
      params.textPosition === 'bottom-center'
        ? 'center'
        : params.textPosition === 'bottom-right'
          ? 'right'
          : 'left';

    return {
      layout: 'overlay',
      mediaAsBackground: true,
      root: {
        position: 'relative',
        height: { xs: 280, sm: 320, md: 360 },
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: `${borderRadius}px`,
        border: `${params.borderWidth}px solid ${borderColor}`,
        backgroundColor: post.cover
          ? 'common.black'
          : resolveColor(params.backgroundColor, alpha(themeColor, 0.12)),
        boxShadow: (theme) =>
          theme.palette.mode === 'light'
            ? `0 8px 32px ${alpha(themeColor, 0.15)}`
            : `0 8px 32px ${alpha(theme.palette.common.black, 0.35)}`,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        '@media (hover: hover) and (pointer: fine)': {
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? `0 16px 48px ${alpha(themeColor, 0.25)}`
                : `0 16px 48px ${alpha(theme.palette.common.black, 0.45)}`,
          },
        },
      },
      media: {
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        backgroundImage: post.cover ? `url(${post.cover})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        transition: 'transform 0.6s ease',
        '@media (hover: hover) and (pointer: fine)': {
          '&:hover': {
            transform: 'scale(1.05)',
          },
        },
      },
      overlay: {
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        background: (theme) =>
          `linear-gradient(to top, ${alpha(theme.palette.common.black, params.overlayOpacity)} 0%, ${alpha(
            theme.palette.common.black,
            params.overlayOpacity * 0.4
          )} 50%, ${alpha(theme.palette.common.black, 0)} 100%)`,
      },
      content: {
        position: 'relative',
        zIndex: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems,
        textAlign,
        p: { xs: 2.5, sm: 3.5 },
        background: (theme) =>
          `linear-gradient(to top, ${alpha(
            theme.palette.mode === 'light' ? theme.palette.common.white : theme.palette.common.black,
            params.glassOpacity
          )} 0%, transparent 70%)`,
        backdropFilter: params.glassOpacity > 0 ? 'blur(8px)' : undefined,
      },
      tag: {
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.22),
        color: 'common.white',
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        border: '1px solid',
        borderColor: (theme) => alpha(theme.palette.common.white, 0.3),
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      },
      title: {
        fontWeight: 800,
        mb: params.showExcerpt ? 1 : 0,
        lineHeight: 1.25,
        fontSize: titleSizeValue(params.titleSize),
        overflowWrap: 'break-word',
        color: params.textColor || 'common.white',
        textShadow: '0 2px 8px rgba(0,0,0,0.5)',
      },
      excerpt: {
        mb: params.showMeta ? 1.5 : 0,
        lineHeight: 1.6,
        fontSize: { xs: '0.875rem', sm: '0.9375rem' },
        overflowWrap: 'break-word',
        color: 'rgba(255,255,255,0.82)',
        textShadow: '0 1px 4px rgba(0,0,0,0.4)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      meta: {
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        color: 'rgba(255,255,255,0.72)',
        typography: 'caption',
        justifyContent: alignItems,
      },
    };
  },
};

const renderers: PostCardRenderer[] = [
  overlayCardRenderer as unknown as PostCardRenderer,
  cleanCardRenderer as unknown as PostCardRenderer,
  bookCardRenderer as unknown as PostCardRenderer,
  newsletterCardRenderer as unknown as PostCardRenderer,
  glassCardRenderer as unknown as PostCardRenderer,
];

export function getPostCardRenderer(variant?: string): PostCardRenderer | undefined {
  if (!variant) return undefined;
  
  
  if (variant === 'default') variant = 'clean-card';
  return renderers.find((r) => r.id === variant || r.aliases?.includes(variant));
}

export function listPostCardRenderers(): PostCardRenderer[] {
  return renderers.slice();
}
