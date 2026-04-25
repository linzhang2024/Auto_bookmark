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


def find_html_files(directory=None):
    """
    搜索指定目录下的所有 .html 文件
    如果没有指定目录，使用当前工作目录
    返回文件路径列表
    """
    if directory is None:
        directory = os.getcwd()
    
    html_files = []
    for file in os.listdir(directory):
        if file.lower().endswith('.html'):
            html_files.append(os.path.join(directory, file))
    
    # 按修改时间排序，最新的在前
    html_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return html_files


def select_html_file(html_files, default_name='bookmarks.html'):
    """
    从 HTML 文件列表中选择一个文件
    优先选择名为 default_name 的文件
    如果有多个文件，询问用户选择
    """
    if not html_files:
        return None
    
    # 检查是否有默认名称的文件
    default_files = [f for f in html_files if os.path.basename(f).lower() == default_name.lower()]
    if default_files:
        return default_files[0]
    
    # 如果只有一个文件，直接返回
    if len(html_files) == 1:
        return html_files[0]
    
    # 如果有多个文件，询问用户选择
    print(f"找到 {len(html_files)} 个 HTML 文件，请选择要转换的文件：")
    for i, file in enumerate(html_files, 1):
        print(f"  {i}. {os.path.basename(file)}")
    print(f"  {len(html_files) + 1}. 取消")
    
    while True:
        try:
            choice = input(f"请输入选择 (1-{len(html_files) + 1}): ").strip()
            choice_num = int(choice)
            if 1 <= choice_num <= len(html_files):
                return html_files[choice_num - 1]
            elif choice_num == len(html_files) + 1:
                return None
            else:
                print(f"请输入 1 到 {len(html_files) + 1} 之间的数字")
        except ValueError:
            print("请输入有效的数字")


def count_bookmarks(items):
    """
    统计书签数量（只统计链接，不统计文件夹）
    """
    count = 0
    for item in items:
        if item['type'] == 'link':
            count += 1
        elif item['type'] == 'folder' and item['children']:
            count += count_bookmarks(item['children'])
    return count


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
    parser.add_argument('input_file', nargs='?', help='输入的 HTML 书签文件路径（可选）')
    parser.add_argument('-o', '--output', help='输出的 Markdown 文件路径（可选）')
    
    args = parser.parse_args()
    
    input_file = args.input_file
    
    # 如果用户没有指定输入文件，或者文件不存在
    if not input_file or not os.path.exists(input_file):
        if input_file and not os.path.exists(input_file):
            print(f"警告: 输入文件 '{input_file}' 不存在")
        
        print("正在搜索当前目录下的 HTML 文件...")
        html_files = find_html_files()
        
        if not html_files:
            print("错误: 当前目录下没有找到任何 HTML 文件")
            return
        
        input_file = select_html_file(html_files)
        if not input_file:
            print("已取消操作")
            return
    
    print(f"正在处理文件: {input_file}")
    
    with open(input_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    bookmarks = parse_chrome_bookmarks(html_content)
    bookmark_count = count_bookmarks(bookmarks)
    
    if bookmark_count == 0:
        print("警告: 没有找到任何有效的书签")
        return
    
    markdown_content = convert_to_markdown(bookmarks)
    
    if args.output:
        output_file = args.output
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(markdown_content)
        print(f"成功转换！共转换了 {bookmark_count} 条书签")
        print(f"输出文件: {output_file}")
    else:
        print(markdown_content)
        print(f"\n成功转换！共转换了 {bookmark_count} 条书签")


if __name__ == '__main__':
    main()
