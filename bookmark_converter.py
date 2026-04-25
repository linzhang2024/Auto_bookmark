#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
from bs4 import BeautifulSoup


def is_localhost_url(url):
    """检查 URL 是否包含 localhost 或 127.0.0.1"""
    if not url:
        return False
    url_lower = url.lower()
    return 'localhost' in url_lower or '127.0.0.1' in url_lower


def parse_chrome_bookmarks(html_content):
    """
    解析 Chrome 导出的 HTML 书签文件
    返回层级结构的列表
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    
    root_dl = soup.find('dl')
    if not root_dl:
        return []
    
    def parse_dl_content(dl_tag, level=0):
        """
        解析 DL 标签内的内容
        返回该 DL 内的所有项目（文件夹和链接）
        """
        items = []
        
        # 找到该 DL 内的所有直接或间接的 DT 标签
        # 但要排除嵌套 DL 内的 DT 标签
        all_dts = dl_tag.find_all('dt')
        direct_dts = []
        
        for dt in all_dts:
            # 检查这个 DT 是否直接属于当前 DL，而不是嵌套的 DL
            parent_dl = None
            current = dt.parent
            while current:
                if current.name == 'dl':
                    parent_dl = current
                    break
                current = current.parent
            
            if parent_dl == dl_tag:
                direct_dts.append(dt)
        
        for dt in direct_dts:
            h3_tag = dt.find('h3', recursive=False)
            a_tag = dt.find('a', recursive=False)
            
            if h3_tag:
                folder_name = h3_tag.get_text(strip=True)
                if not folder_name:
                    continue
                
                # 找到 H3 标签后面的 DL 标签（该文件夹的内容）
                sub_dl = h3_tag.find_next_sibling('dl')
                
                if sub_dl:
                    sub_items = parse_dl_content(sub_dl, level + 1)
                    items.append({
                        'type': 'folder',
                        'name': folder_name,
                        'level': level,
                        'children': sub_items
                    })
                else:
                    items.append({
                        'type': 'folder',
                        'name': folder_name,
                        'level': level,
                        'children': []
                    })
            
            elif a_tag:
                url = a_tag.get('href', '')
                if is_localhost_url(url):
                    continue
                
                title = a_tag.get_text(strip=True)
                if not title:
                    title = url
                
                items.append({
                    'type': 'link',
                    'title': title,
                    'url': url,
                    'level': level
                })
        
        return items
    
    return parse_dl_content(root_dl)


def convert_to_markdown(items):
    """
    将解析后的书签结构转换为 Markdown 格式
    """
    markdown_lines = []
    
    def process_items(items_list):
        for item in items_list:
            if item['type'] == 'folder':
                level = item['level'] + 1
                title = item['name']
                markdown_lines.append(f"{'#' * level} {title}")
                markdown_lines.append('')
                
                if item['children']:
                    process_items(item['children'])
                    
                    if len(markdown_lines) > 0 and markdown_lines[-1] != '':
                        markdown_lines.append('')
            
            elif item['type'] == 'link':
                level = item['level']
                title = item['title']
                url = item['url']
                
                indent = '  ' * level
                markdown_lines.append(f"{indent}- [{title}]({url})")
    
    process_items(items)
    
    return '\n'.join(markdown_lines)


def main():
    parser = argparse.ArgumentParser(
        description='将 Chrome 导出的 HTML 书签转换为 Markdown 列表'
    )
    parser.add_argument('input_file', help='输入的 HTML 书签文件路径')
    parser.add_argument('-o', '--output', help='输出的 Markdown 文件路径（可选）')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input_file):
        print(f"错误: 输入文件 '{args.input_file}' 不存在")
        return
    
    with open(args.input_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    bookmarks = parse_chrome_bookmarks(html_content)
    markdown_content = convert_to_markdown(bookmarks)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(markdown_content)
        print(f"成功转换！输出文件: {args.output}")
    else:
        print(markdown_content)


if __name__ == '__main__':
    main()
