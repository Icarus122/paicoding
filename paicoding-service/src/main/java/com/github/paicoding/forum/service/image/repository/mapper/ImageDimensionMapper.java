package com.github.paicoding.forum.service.image.repository.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.github.paicoding.forum.service.image.repository.entity.ImageDimensionDO;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

/**
 * 图片尺寸mapper接口
 *
 * @author YiHui
 * @date 2026/7/9
 */
public interface ImageDimensionMapper extends BaseMapper<ImageDimensionDO> {

    /**
     * 插入或更新图片尺寸（并发探测同一张图时避免唯一键冲突）
     */
    @Insert("INSERT INTO image_dimension (url_hash, url, width, height) VALUES (#{urlHash}, #{url}, #{width}, #{height}) " +
            "ON DUPLICATE KEY UPDATE width = #{width}, height = #{height}")
    void insertOrUpdate(@Param("urlHash") String urlHash, @Param("url") String url,
                        @Param("width") int width, @Param("height") int height);
}
