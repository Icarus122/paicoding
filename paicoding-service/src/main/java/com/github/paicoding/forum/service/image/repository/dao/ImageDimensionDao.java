package com.github.paicoding.forum.service.image.repository.dao;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.github.paicoding.forum.service.image.repository.entity.ImageDimensionDO;
import com.github.paicoding.forum.service.image.repository.mapper.ImageDimensionMapper;
import org.springframework.stereotype.Repository;

/**
 * 图片尺寸
 *
 * @author YiHui
 * @date 2026/7/9
 */
@Repository
public class ImageDimensionDao extends ServiceImpl<ImageDimensionMapper, ImageDimensionDO> {

    public ImageDimensionDO getByUrlHash(String urlHash) {
        return lambdaQuery()
                .eq(ImageDimensionDO::getUrlHash, urlHash)
                .one();
    }

    public void insertOrUpdate(String urlHash, String url, int width, int height) {
        baseMapper.insertOrUpdate(urlHash, url, width, height);
    }
}
