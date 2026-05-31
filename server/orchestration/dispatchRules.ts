export interface DispatchRule {
  agentId: string
  keywords: {
    en: string[]
    zh: string[]
  }
}

export const CONJUNCTIONS = {
  en: ['and', 'also', 'plus', 'as well as', 'in addition'],
  zh: ['并且', '同时', '以及', '还要', '另外', '而且', '和'],
}

export const DEPENDENCIES = {
  en: ['then', 'after', 'once', 'before', 'first', 'next', 'followed by'],
  zh: ['然后', '之后', '完成后', '先', '再', '等', '好了再', '接着'],
}

export const DISPATCH_RULES: DispatchRule[] = [
  {
    agentId: 'ui-designer',
    keywords: {
      en: ['ui design', 'styling', 'visual', 'layout', 'css', 'beautify', 'redesign', 'pixel', 'theme', 'color scheme', 'responsive'],
      zh: ['样式', '美化', '视觉', 'UI', '界面设计', '布局', '太丑', '配色', '主题'],
    },
  },
  {
    agentId: 'code-reviewer',
    keywords: {
      en: ['code review', 'review code', 'security scan', 'audit code', 'review pr', 'review this'],
      zh: ['代码审查', '评审代码', '审查', 'review', '安全扫描', '代码质量'],
    },
  },
  {
    agentId: 'fullstack-engineer',
    keywords: {
      en: ['fix', 'bug', 'debug', 'implement', 'build', 'create', 'add feature', 'refactor', 'update', 'modify', 'change', 'write code'],
      zh: ['修复', '实现', '开发', '创建', '添加', '修改', '重构', '为啥不行', '状态不对', '写代码'],
    },
  },
  {
    agentId: 'architect',
    keywords: {
      en: ['architecture', 'layering', 'module boundary', 'system design', 'restructure'],
      zh: ['架构', '模块边界', '重构架构', '系统设计'],
    },
  },
  {
    agentId: 'devops-engineer',
    keywords: {
      en: ['deploy', 'ci/cd', 'pipeline', 'environment', 'staging', 'production', 'docker', 'kubernetes'],
      zh: ['部署', '上线', '环境配置', 'CI/CD', '流水线'],
    },
  },
  {
    agentId: 'image-creator',
    keywords: {
      en: ['design logo', 'create logo', 'icon', 'brand', 'illustration', 'generate image'],
      zh: ['设计logo', '图标', '品牌', '插画', '生成图片'],
    },
  },
  {
    agentId: 'product-strategist',
    keywords: {
      en: ['competitive analysis', 'product research', 'prd', 'product design', 'user research', 'market analysis'],
      zh: ['竞品分析', '产品调研', 'PRD', '产品设计', '用户研究'],
    },
  },
]
