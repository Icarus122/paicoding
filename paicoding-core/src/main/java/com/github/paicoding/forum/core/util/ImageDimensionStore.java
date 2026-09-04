package com.github.paicoding.forum.core.util;

/**
 * 图片尺寸持久化存储，用于给正文图片补充 width/height 占位（CLS 优化）。
 * 实现方需保证 find/save 内部吞掉异常，任何存储故障都不能影响页面渲染。
 *
 * @author YiHui
 * @date 2026/7/9
 */
public interface ImageDimensionStore {

    /**
     * 查询图片尺寸
     *
     * @param url 规范化后的图片地址
     * @return [width, height]，未收录时返回 null
     */
    int[] find(String url);

    /**
     * 保存/更新图片尺寸
     */
    void save(String url, int width, int height);
}
