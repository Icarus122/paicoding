package com.github.paicoding.forum.service.image.repository.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.github.paicoding.forum.api.model.entity.BaseDO;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 图片尺寸表：持久化正文图片的宽高，渲染时直接查表补充 width/height 占位，消除 CLS
 *
 * @author YiHui
 * @date 2026/7/9
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("image_dimension")
public class ImageDimensionDO extends BaseDO {

    private static final long serialVersionUID = 1L;

    /**
     * 图片URL的MD5，唯一键
     */
    private String urlHash;

    /**
     * 图片URL
     */
    private String url;

    /**
     * 原始宽度（像素）
     */
    private Integer width;

    /**
     * 原始高度（像素）
     */
    private Integer height;
}
